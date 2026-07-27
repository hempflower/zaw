package bootstrap

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestDomainAndUsecaseDependencyDirection(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate architecture test")
	}
	internalRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), ".."))
	tests := []struct {
		name          string
		directory     string
		allowedPrefix string
	}{
		{
			name:          "domain",
			directory:     filepath.Join(internalRoot, "domain"),
			allowedPrefix: "github.com/zaw-dev/zaw/internal/domain",
		},
		{
			name:          "usecase",
			directory:     filepath.Join(internalRoot, "usecase"),
			allowedPrefix: "github.com/zaw-dev/zaw/internal/domain",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertInternalImports(t, test.directory, test.allowedPrefix)
		})
	}
}

func TestWorkbenchArchitectureBoundaries(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate architecture test")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "../.."))
	workbenchRoot := filepath.Join(repositoryRoot, "packages", "workbench", "src")
	for _, directory := range []string{
		"bootstrap",
		"services",
		"providers",
		"parts",
		"views",
		"styles",
	} {
		if info, err := fs.Stat(os.DirFS(workbenchRoot), directory); err != nil ||
			!info.IsDir() {
			t.Errorf("Workbench directory %s is missing", directory)
		}
	}
	assertSourceDoesNotContain(
		t,
		filepath.Join(repositoryRoot, "apps"),
		[]string{"from \"react\"", "from 'react'"},
	)
	assertSourceDoesNotContain(
		t,
		filepath.Join(repositoryRoot, "packages"),
		[]string{"from \"react\"", "from 'react'"},
	)
	for _, directory := range []string{"parts", "views", "widgets"} {
		path := filepath.Join(workbenchRoot, directory)
		assertSourceDoesNotContain(
			t,
			path,
			[]string{"fetch(", "new WebSocket("},
		)
		assertUIClassesExtendWidget(t, path)
	}
}

func assertUIClassesExtendWidget(t *testing.T, directory string) {
	t.Helper()
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".ts" {
			return err
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, line := range strings.Split(string(contents), "\n") {
			if strings.Contains(line, "export class ") &&
				!strings.Contains(line, " extends Widget") {
				t.Errorf("%s contains a UI class that does not extend Widget: %s", path, line)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("inspect Widget classes in %s: %v", directory, err)
	}
}

func assertSourceDoesNotContain(
	t *testing.T,
	directory string,
	forbidden []string,
) {
	t.Helper()
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "node_modules" || entry.Name() == "dist" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".ts" && filepath.Ext(path) != ".tsx" &&
			filepath.Ext(path) != ".json" {
			return nil
		}
		if filepath.Ext(path) == ".tsx" {
			t.Errorf("%s uses the removed TSX/React-style source format", path)
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, value := range forbidden {
			if strings.Contains(string(contents), value) {
				t.Errorf("%s contains forbidden Workbench dependency %q", path, value)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("inspect %s: %v", directory, err)
	}
}

func assertInternalImports(t *testing.T, directory string, allowedPrefix string) {
	t.Helper()
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imported := range file.Imports {
			importPath, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				return err
			}
			if strings.Contains(importPath, "/internal/") &&
				!strings.HasPrefix(importPath, allowedPrefix) {
				t.Errorf("%s imports forbidden package %s", path, importPath)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("inspect %s: %v", directory, err)
	}
}
