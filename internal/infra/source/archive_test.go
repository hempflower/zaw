package source

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractArchiveRejectsPathEscape(t *testing.T) {
	archive := tarBytes(t, "../outside.txt", []byte("blocked"), tar.TypeReg)
	destination := t.TempDir()
	if err := ExtractArchive("tar", bytes.NewReader(archive), destination); err == nil {
		t.Fatal("expected path escape to be rejected")
	}
}

func TestExtractArchiveRejectsSymlink(t *testing.T) {
	archive := tarBytes(t, "link", nil, tar.TypeSymlink)
	if err := ExtractArchive("tar", bytes.NewReader(archive), t.TempDir()); err == nil {
		t.Fatal("expected symbolic link to be rejected")
	}
}

func TestExtractArchiveWritesRegularFile(t *testing.T) {
	archive := tarBytes(t, "module/main.tf", []byte("terraform {}"), tar.TypeReg)
	destination := t.TempDir()
	if err := ExtractArchive("tar", bytes.NewReader(archive), destination); err != nil {
		t.Fatalf("extract archive: %v", err)
	}
	contents, err := os.ReadFile(filepath.Join(destination, "module", "main.tf"))
	if err != nil {
		t.Fatalf("read extracted file: %v", err)
	}
	if string(contents) != "terraform {}" {
		t.Fatalf("unexpected file contents: %q", contents)
	}
}

func TestCredentialArchiveOptions(t *testing.T) {
	token := sourceCredential{
		kind:   "token",
		secret: map[string]string{"token": "not-in-url"},
	}
	if got := token.archiveOptions().BearerToken; got != "not-in-url" {
		t.Fatalf("token = %q", got)
	}
	password := sourceCredential{
		kind:     "username_password",
		username: "zaw",
		secret:   map[string]string{"password": "secret"},
	}
	options := password.archiveOptions()
	if options.Username != "zaw" || options.Password != "secret" {
		t.Fatalf("unexpected basic auth options: %#v", options)
	}
	if ssh := (sourceCredential{kind: "ssh_key"}).archiveOptions(); ssh != (DownloadOptions{}) {
		t.Fatalf("SSH credential must not be used for an HTTP archive: %#v", ssh)
	}
}

func tarBytes(t *testing.T, name string, contents []byte, kind byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	header := &tar.Header{
		Name:     name,
		Mode:     0o644,
		Size:     int64(len(contents)),
		Typeflag: kind,
	}
	if err := writer.WriteHeader(header); err != nil {
		t.Fatalf("write header: %v", err)
	}
	if _, err := io.Copy(writer, bytes.NewReader(contents)); err != nil {
		t.Fatalf("write archive entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return buffer.Bytes()
}
