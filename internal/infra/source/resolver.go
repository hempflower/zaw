package source

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/zaw-dev/zaw/internal/domain"
)

const maxTemplateArchiveBytes = 200 << 20

type Resolver struct {
	secrets domain.SecretStore
}

func NewResolver(secrets domain.SecretStore) domain.SourceResolver {
	return Resolver{secrets: secrets}
}

func (r Resolver) ResolveGit(
	ctx context.Context,
	rawURL string,
	ref string,
	credentialID string,
) (string, error) {
	if err := validateOutboundURL(rawURL, true); err != nil {
		return "", err
	}
	credential, err := r.credential(ctx, credentialID)
	if err != nil {
		return "", err
	}
	environment, cleanup, err := credential.gitEnvironment()
	if err != nil {
		return "", err
	}
	defer cleanup()
	commandCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	command := exec.CommandContext(commandCtx, "git", "ls-remote", rawURL, ref)
	command.Env = append(os.Environ(), environment...)
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("cannot resolve git ref: %w", err)
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 || len(fields[0]) != 40 {
		return "", fmt.Errorf("git ref did not resolve to a commit")
	}
	return fields[0], nil
}

func (r Resolver) ResolveTar(
	ctx context.Context,
	rawURL string,
	expectedSHA256 string,
	credentialID string,
) (string, string, error) {
	credential, err := r.credential(ctx, credentialID)
	if err != nil {
		return "", "", err
	}
	contents, format, sha256, err := DownloadArchiveWithOptions(
		ctx,
		rawURL,
		expectedSHA256,
		credential.archiveOptions(),
	)
	_ = contents
	return sha256, format, err
}

type sourceCredential struct {
	kind     string
	username string
	secret   map[string]string
}

func (r Resolver) credential(
	ctx context.Context,
	credentialID string,
) (sourceCredential, error) {
	if credentialID == "" {
		return sourceCredential{}, nil
	}
	if r.secrets == nil {
		return sourceCredential{}, fmt.Errorf("source credentials are not configured")
	}
	secret, err := r.secrets.Read(ctx, "zaw/credentials/"+credentialID)
	if err != nil {
		return sourceCredential{}, fmt.Errorf("read source credential: %w", err)
	}
	return sourceCredential{
		kind:     secret["_zaw_kind"],
		username: secret["_zaw_metadata_username"],
		secret:   secret,
	}, nil
}

func (c sourceCredential) archiveOptions() DownloadOptions {
	if c.kind == "username_password" {
		return DownloadOptions{
			Username: c.username,
			Password: c.secret["password"],
		}
	}
	if c.kind == "token" {
		return DownloadOptions{BearerToken: c.secret["token"]}
	}
	return DownloadOptions{}
}

func (c sourceCredential) gitEnvironment() ([]string, func(), error) {
	if c.kind == "" {
		return []string{"GIT_TERMINAL_PROMPT=0"}, func() {}, nil
	}
	directory, err := os.MkdirTemp("", "zaw-source-credential-*")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(directory) }
	if c.kind == "ssh_key" {
		keyPath := filepath.Join(directory, "key")
		if err := os.WriteFile(keyPath, []byte(c.secret["privateKey"]), 0o600); err != nil {
			cleanup()
			return nil, nil, err
		}
		return []string{
			"GIT_TERMINAL_PROMPT=0",
			"GIT_SSH_COMMAND=ssh -i " + keyPath + " -o IdentitiesOnly=yes",
		}, cleanup, nil
	}
	username := c.username
	password := c.secret["password"]
	if c.kind == "token" {
		username = "x-access-token"
		password = c.secret["token"]
	}
	askPassPath := filepath.Join(directory, "askpass")
	script := "#!/bin/sh\n"
	script += "case \"$1\" in\n"
	script += "  *Username*) printf '%s' \"$ZAW_GIT_USERNAME\" ;;\n"
	script += "  *) printf '%s' \"$ZAW_GIT_PASSWORD\" ;;\n"
	script += "esac\n"
	if err := os.WriteFile(askPassPath, []byte(script), 0o700); err != nil {
		cleanup()
		return nil, nil, err
	}
	return []string{
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=" + askPassPath,
		"ZAW_GIT_USERNAME=" + username,
		"ZAW_GIT_PASSWORD=" + password,
	}, cleanup, nil
}

func DownloadArchive(
	ctx context.Context,
	rawURL string,
	expectedSHA256 string,
) ([]byte, string, string, error) {
	return DownloadArchiveWithOptions(
		ctx,
		rawURL,
		expectedSHA256,
		DownloadOptions{},
	)
}

type DownloadOptions struct {
	Username    string
	Password    string
	BearerToken string
}

func DownloadArchiveWithOptions(
	ctx context.Context,
	rawURL string,
	expectedSHA256 string,
	options DownloadOptions,
) ([]byte, string, string, error) {
	if err := validateOutboundURL(rawURL, false); err != nil {
		return nil, "", "", err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return validateOutboundURL(request.URL.String(), false)
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	if options.BearerToken != "" {
		request.Header.Set("Authorization", "Bearer "+options.BearerToken)
	}
	if options.Username != "" || options.Password != "" {
		request.SetBasicAuth(options.Username, options.Password)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", "", fmt.Errorf("download template archive: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", "", fmt.Errorf("archive returned %s", response.Status)
	}
	hasher := sha256.New()
	limited := io.LimitReader(response.Body, maxTemplateArchiveBytes+1)
	contents, err := io.ReadAll(io.TeeReader(limited, hasher))
	if err != nil {
		return nil, "", "", err
	}
	if int64(len(contents)) > maxTemplateArchiveBytes {
		return nil, "", "", fmt.Errorf("archive exceeds download size limit")
	}
	digest := hex.EncodeToString(hasher.Sum(nil))
	if expectedSHA256 != "" && !strings.EqualFold(expectedSHA256, digest) {
		return nil, "", "", fmt.Errorf("archive sha256 mismatch")
	}
	format := formatFromURL(rawURL)
	if format == "" {
		return nil, "", "", fmt.Errorf("archive format must be tar, tar.gz, or tar.zst")
	}
	return contents, format, digest, nil
}

func formatFromURL(rawURL string) string {
	path := strings.ToLower(rawURL)
	switch {
	case strings.HasSuffix(path, ".tar.gz") || strings.HasSuffix(path, ".tgz"):
		return "tar.gz"
	case strings.HasSuffix(path, ".tar.zst") || strings.HasSuffix(path, ".tzst"):
		return "tar.zst"
	case strings.HasSuffix(path, ".tar"):
		return "tar"
	default:
		return ""
	}
}

func validateOutboundURL(rawURL string, allowSSH bool) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid source URL: %w", err)
	}
	ssh := allowSSH && parsed.Scheme == "ssh"
	if parsed.Scheme != "https" && parsed.Scheme != "http" && !ssh {
		suffix := map[bool]string{true: " or ssh", false: ""}[allowSSH]
		return fmt.Errorf("source URL must use http(s)%s", suffix)
	}
	if parsed.User != nil && !ssh {
		return fmt.Errorf("source URL must not contain credentials")
	}
	if parsed.Hostname() == "" {
		return fmt.Errorf("source URL must have a host")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(context.Background(), parsed.Hostname())
	if err != nil {
		return fmt.Errorf("cannot resolve source host")
	}
	for _, address := range addresses {
		if privateAddress(address.IP) {
			return fmt.Errorf("source URL resolves to a prohibited address")
		}
	}
	return nil
}

func privateAddress(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
