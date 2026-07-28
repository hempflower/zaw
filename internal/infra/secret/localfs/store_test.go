package localfs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundTripUsesProtectedFiles(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "secrets")
	storeValue, err := New(directory)
	if err != nil {
		t.Fatal(err)
	}
	store := storeValue.(*Store)
	ref := "zaw/credentials/example"
	if err := store.Put(context.Background(), ref, map[string]string{"token": "secret"}); err != nil {
		t.Fatal(err)
	}
	values, err := store.Read(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if values["token"] != "secret" {
		t.Fatalf("token = %q", values["token"])
	}
	info, err := os.Stat(filepath.Join(directory, "zaw", "credentials", "example.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("secret mode = %o, want 600", info.Mode().Perm())
	}
	if err := store.Delete(context.Background(), ref); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(context.Background(), ref); err == nil {
		t.Fatal("deleted secret remained readable")
	}
}

func TestStoreRejectsReferencesOutsideItsDirectory(t *testing.T) {
	storeValue, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := storeValue.(*Store)
	for _, ref := range []string{"", "../secret", "/absolute"} {
		if err := store.Put(context.Background(), ref, map[string]string{"token": "secret"}); err == nil {
			t.Fatalf("reference %q was accepted", ref)
		}
	}
}
