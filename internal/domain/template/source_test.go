package template

import "testing"

func TestSourceSnapshotRejectsEscapingDirectory(t *testing.T) {
	tests := []string{"../outside", "/tmp/template"}
	for _, directory := range tests {
		snapshot := SourceSnapshot{
			Kind:      TarSource,
			URL:       "https://example.test/template.tar.gz",
			SHA256:    "0123456789abcdef",
			Directory: directory,
		}
		if err := snapshot.ValidateImmutable(); err == nil {
			t.Fatalf("directory %q should be rejected", directory)
		}
	}
}

func TestSourceSnapshotAcceptsNestedDirectory(t *testing.T) {
	snapshot := SourceSnapshot{
		Kind:      GitSource,
		URL:       "https://example.test/template.git",
		Commit:    "0123456789abcdef",
		Directory: "templates/ubuntu",
	}
	if err := snapshot.ValidateImmutable(); err != nil {
		t.Fatalf("nested directory should be accepted: %v", err)
	}
}
