package httptransport

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSingleUserAuthentication(t *testing.T) {
	server := New(nil, nil, nil)
	server.ConfigureAuthentication(
		"correct horse", "provisioner-secret", "test-auth-signing-key-at-least-32-bytes",
	)
	handler := server.Handler()

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.Code)
	}

	wrong := httptest.NewRecorder()
	wrongRequest := httptest.NewRequest(
		http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"password":"wrong"}`),
	)
	handler.ServeHTTP(wrong, wrongRequest)
	if wrong.Code != http.StatusUnauthorized || len(wrong.Result().Cookies()) != 0 {
		t.Fatalf("wrong login status = %d, cookies = %d", wrong.Code, len(wrong.Result().Cookies()))
	}

	login := httptest.NewRecorder()
	loginRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/login",
		bytes.NewBufferString(`{"password":"correct horse"}`),
	)
	handler.ServeHTTP(login, loginRequest)
	if login.Code != http.StatusOK || len(login.Result().Cookies()) != 1 {
		t.Fatalf("login status = %d, cookies = %d", login.Code, len(login.Result().Cookies()))
	}
	cookie := login.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unsafe session cookie: %#v", cookie)
	}
	if cookie.MaxAge != 15*24*60*60 {
		t.Fatalf("session cookie MaxAge = %d", cookie.MaxAge)
	}
	if strings.Count(cookie.Value, ".") != 2 {
		t.Fatalf("session cookie is not a JWT: %q", cookie.Value)
	}
	authorizedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	authorizedRequest.AddCookie(cookie)
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusOK {
		t.Fatalf("JWT-authenticated status = %d", authorized.Code)
	}
	parts := strings.Split(cookie.Value, ".")
	parts[1] += "x"
	tamperedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	tamperedRequest.AddCookie(&http.Cookie{
		Name: sessionCookieName, Value: strings.Join(parts, "."),
	})
	tampered := httptest.NewRecorder()
	handler.ServeHTTP(tampered, tamperedRequest)
	if tampered.Code != http.StatusUnauthorized {
		t.Fatalf("tampered JWT status = %d", tampered.Code)
	}
}

func TestProvisionerUsesIndependentBearerKey(t *testing.T) {
	server := New(nil, nil, nil)
	server.ConfigureAuthentication(
		"browser-password", "provisioner-secret", "test-auth-signing-key-at-least-32-bytes",
	)
	handler := server.auth.requireProvisioner(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) },
	))

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodPost, "/", nil))
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing key status = %d", missing.Code)
	}

	validRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	validRequest.Header.Set("Authorization", "Bearer provisioner-secret")
	valid := httptest.NewRecorder()
	handler.ServeHTTP(valid, validRequest)
	if valid.Code != http.StatusNoContent {
		t.Fatalf("valid provisioner status = %d", valid.Code)
	}
}
