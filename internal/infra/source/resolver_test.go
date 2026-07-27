package source

import (
	"strings"
	"testing"
)

func TestValidateOutboundURLRejectsPrivateTargetsAndInlineCredentials(t *testing.T) {
	for _, rawURL := range []string{
		"http://127.0.0.1/template.tar",
		"http://169.254.169.254/latest/meta-data.tar",
		"ssh://git@127.0.0.1/template.git",
		"https://user:secret@example.com/template.tar",
	} {
		err := validateOutboundURL(rawURL, true)
		if err == nil {
			t.Fatalf("URL %q should be rejected", rawURL)
		}
		if strings.Contains(err.Error(), "secret") {
			t.Fatalf("validation error leaked URL credentials: %v", err)
		}
	}
}

func TestFormatFromURLRecognizesSupportedArchives(t *testing.T) {
	tests := map[string]string{
		"https://example.com/template.tar":     "tar",
		"https://example.com/template.tar.gz":  "tar.gz",
		"https://example.com/template.tar.zst": "tar.zst",
		"https://example.com/template.zip":     "",
	}
	for rawURL, expected := range tests {
		if actual := formatFromURL(rawURL); actual != expected {
			t.Fatalf("formatFromURL(%q) = %q, want %q", rawURL, actual, expected)
		}
	}
}
