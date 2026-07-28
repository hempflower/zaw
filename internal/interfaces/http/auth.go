package httptransport

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

const sessionCookieName = "zaw_session"

type authentication struct {
	passwordHash   [sha256.Size]byte
	provisionerKey [sha256.Size]byte
	jwtSigningKey  [sha256.Size]byte
	enabled        bool
	sessionTTL     time.Duration
}

type sessionClaims struct {
	Audience  string `json:"aud"`
	ExpiresAt int64  `json:"exp"`
	IssuedAt  int64  `json:"iat"`
	Issuer    string `json:"iss"`
	JWTID     string `json:"jti"`
	Subject   string `json:"sub"`
}

func (a *authentication) configure(password, provisionerKey, signingKey string) {
	a.passwordHash = sha256.Sum256([]byte(password))
	a.provisionerKey = sha256.Sum256([]byte(provisionerKey))
	a.jwtSigningKey = sha256.Sum256([]byte(signingKey))
	a.enabled = password != ""
	a.sessionTTL = 15 * 24 * time.Hour
}

func (a *authentication) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Password string `json:"password"`
	}
	if err := decodeLimit(r, &input, 8<<10); err != nil {
		fail(w, http.StatusBadRequest, "invalid login request")
		return
	}
	candidate := sha256.Sum256([]byte(input.Password))
	if subtle.ConstantTimeCompare(candidate[:], a.passwordHash[:]) != 1 {
		time.Sleep(150 * time.Millisecond)
		fail(w, http.StatusUnauthorized, "invalid password")
		return
	}
	token, expires, err := a.issueSession(devUserID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "unable to create session")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Value: token, Path: "/", Expires: expires,
		MaxAge: int(a.sessionTTL.Seconds()), HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil,
	})
	respond(w, http.StatusOK, map[string]bool{"authenticated": true})
}

func (a *authentication) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookieName, Path: "/", MaxAge: -1, HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (a *authentication) status(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]bool{"authenticated": a.authenticated(r)})
}

func (a *authentication) authenticated(r *http.Request) bool {
	if !a.enabled {
		return true
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}
	claims, ok := a.verifySession(cookie.Value)
	return ok && claims.Subject == devUserID
}

func (a *authentication) issueSession(subject string) (string, time.Time, error) {
	now := time.Now()
	expires := now.Add(a.sessionTTL)
	jti := make([]byte, 16)
	if _, err := rand.Read(jti); err != nil {
		return "", time.Time{}, err
	}
	header := base64.RawURLEncoding.EncodeToString(
		[]byte(`{"alg":"HS256","typ":"JWT"}`),
	)
	payload, err := json.Marshal(sessionClaims{
		Audience: "zaw-workbench", ExpiresAt: expires.Unix(),
		IssuedAt: now.Unix(), Issuer: "zaw", Subject: subject,
		JWTID: base64.RawURLEncoding.EncodeToString(jti),
	})
	if err != nil {
		return "", time.Time{}, err
	}
	unsigned := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, a.jwtSigningKey[:])
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), expires, nil
}

func (a *authentication) verifySession(token string) (sessionClaims, bool) {
	var claims sessionClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(token) > 4096 {
		return claims, false
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return claims, false
	}
	var metadata struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if json.Unmarshal(header, &metadata) != nil ||
		metadata.Algorithm != "HS256" || metadata.Type != "JWT" {
		return claims, false
	}
	mac := hmac.New(sha256.New, a.jwtSigningKey[:])
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return claims, false
	}
	now := time.Now().Unix()
	valid := claims.Issuer == "zaw" && claims.Audience == "zaw-workbench" &&
		claims.Subject != "" && claims.JWTID != "" && claims.IssuedAt <= now+30 &&
		claims.ExpiresAt > now
	return claims, valid
}

func (a *authentication) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.authenticated(r) {
			fail(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *authentication) requireProvisioner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.enabled {
			next.ServeHTTP(w, r)
			return
		}
		value := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		candidate := sha256.Sum256([]byte(value))
		if value == "" || subtle.ConstantTimeCompare(candidate[:], a.provisionerKey[:]) != 1 {
			fail(w, http.StatusUnauthorized, "invalid provisioner key")
			return
		}
		next.ServeHTTP(w, r)
	})
}
