package source

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

const (
	maxArchiveFiles           = 10_000
	maxUnpackedBytes    int64 = 500 << 20
	maxCompressionRatio       = 100
)

func ExtractArchive(
	format string,
	input io.Reader,
	destination string,
) error {
	counted := &countingReader{Reader: input}
	archive, closeArchive, err := openArchive(format, counted)
	if err != nil {
		return err
	}
	defer closeArchive()

	reader := tar.NewReader(archive)
	var totalBytes int64
	var fileCount int
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read archive: %w", err)
		}
		fileCount++
		if fileCount > maxArchiveFiles {
			return fmt.Errorf("archive has too many files")
		}
		target, err := archiveTarget(destination, header.Name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			written, err := writeArchiveFile(target, reader, header.FileInfo().Mode())
			if err != nil {
				return err
			}
			totalBytes += written
			if totalBytes > maxUnpackedBytes {
				return fmt.Errorf("archive expands beyond size limit")
			}
			if counted.Bytes > 0 && totalBytes > counted.Bytes*maxCompressionRatio {
				return fmt.Errorf("archive compression ratio exceeds limit")
			}
		default:
			return fmt.Errorf("archive entry %q has prohibited type", header.Name)
		}
	}
}

func openArchive(format string, input io.Reader) (io.Reader, func() error, error) {
	switch format {
	case "tar":
		return input, func() error { return nil }, nil
	case "tar.gz":
		reader, err := gzip.NewReader(input)
		if err != nil {
			return nil, nil, fmt.Errorf("open gzip archive: %w", err)
		}
		return reader, reader.Close, nil
	case "tar.zst":
		reader, err := zstd.NewReader(input)
		if err != nil {
			return nil, nil, fmt.Errorf("open zstd archive: %w", err)
		}
		return reader, func() error { reader.Close(); return nil }, nil
	default:
		return nil, nil, fmt.Errorf("unsupported archive format %q", format)
	}
}

func archiveTarget(destination string, name string) (string, error) {
	clean := filepath.Clean(name)
	if filepath.IsAbs(clean) || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("archive entry %q escapes destination", name)
	}
	target := filepath.Join(destination, clean)
	root := filepath.Clean(destination) + string(filepath.Separator)
	if !strings.HasPrefix(target, root) {
		return "", fmt.Errorf("archive entry %q escapes destination", name)
	}
	return target, nil
}

func writeArchiveFile(path string, input io.Reader, mode os.FileMode) (int64, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode.Perm())
	if err != nil {
		return 0, err
	}
	defer file.Close()
	return io.Copy(file, input)
}

type countingReader struct {
	io.Reader
	Bytes int64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	n, err := r.Reader.Read(buffer)
	r.Bytes += int64(n)
	return n, err
}
