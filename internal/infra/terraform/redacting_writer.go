package terraform

import (
	"bytes"
	"io"
	"sort"
	"sync"
)

type redactingWriter struct {
	mu          sync.Mutex
	destination io.Writer
	redactions  [][]byte
	pending     []byte
	err         error
}

func newRedactingWriter(destination io.Writer, values []string) *redactingWriter {
	unique := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			unique[value] = struct{}{}
		}
	}
	ordered := make([]string, 0, len(unique))
	for value := range unique {
		ordered = append(ordered, value)
	}
	sort.Slice(ordered, func(left int, right int) bool {
		return len(ordered[left]) > len(ordered[right])
	})
	redactions := make([][]byte, 0, len(ordered))
	for _, value := range ordered {
		redactions = append(redactions, []byte(value))
	}
	return &redactingWriter{destination: destination, redactions: redactions}
}

func (w *redactingWriter) Write(payload []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return 0, w.err
	}
	w.pending = append(w.pending, payload...)
	for {
		newline := bytes.IndexByte(w.pending, '\n')
		if newline < 0 {
			break
		}
		if err := w.writeRedacted(w.pending[:newline+1]); err != nil {
			w.err = err
			return 0, err
		}
		w.pending = w.pending[newline+1:]
	}
	return len(payload), nil
}

func (w *redactingWriter) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return w.err
	}
	if len(w.pending) == 0 {
		return nil
	}
	if err := w.writeRedacted(w.pending); err != nil {
		w.err = err
		return err
	}
	w.pending = nil
	return nil
}

func (w *redactingWriter) writeRedacted(payload []byte) error {
	redacted := append([]byte{}, payload...)
	for _, value := range w.redactions {
		redacted = bytes.ReplaceAll(redacted, value, []byte("[REDACTED]"))
	}
	_, err := w.destination.Write(redacted)
	return err
}
