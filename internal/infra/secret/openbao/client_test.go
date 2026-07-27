package openbao

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadReturnsKVv2Secret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/v1/secret/data/zaw/credentials/example" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("X-Vault-Token") != "test-token" {
			t.Fatal("secret manager token was not supplied")
		}
		_, _ = io.WriteString(w, `{"data":{"data":{"token":"value"}}}`)
	}))
	defer server.Close()

	client := Client{
		address:    server.URL,
		token:      "test-token",
		httpClient: server.Client(),
	}
	values, err := client.Read(context.Background(), "zaw/credentials/example")
	if err != nil {
		t.Fatalf("read secret: %v", err)
	}
	if values["token"] != "value" {
		t.Fatalf("secret = %q, want value", values["token"])
	}
}
