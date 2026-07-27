package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/microsoft/agent-host-protocol/clients/go/ahp"
	"github.com/zaw-dev/zaw/internal/ahpmux"
)

const maxLogicalPeers = 16

type MuxFrame = ahpmux.Frame
type MuxFrameType = ahpmux.FrameType

const (
	MuxFrameOpen   = ahpmux.FrameOpen
	MuxFrameOpened = ahpmux.FrameOpened
	MuxFrameData   = ahpmux.FrameData
	MuxFrameClose  = ahpmux.FrameClose
)

func (h *Host) handleMuxFrame(payload []byte, enqueue func([]byte)) error {
	var frame MuxFrame
	if err := json.Unmarshal(payload, &frame); err != nil {
		return fmt.Errorf("decode Mux frame: %w", err)
	}
	if err := frame.Validate(); err != nil {
		return err
	}
	switch frame.Type {
	case MuxFrameOpen:
		peer, err := h.addMuxPeer(frame.StreamID, enqueue)
		if err != nil {
			enqueue(ahpmux.Marshal(MuxFrame{
				Type:     MuxFrameClose,
				StreamID: frame.StreamID,
				Reason:   err.Error(),
			}))
			return nil
		}
		if peer != nil {
			enqueue(ahpmux.Marshal(MuxFrame{
				Type:     MuxFrameOpened,
				StreamID: frame.StreamID,
			}))
		}
	case MuxFrameData:
		peer := h.muxPeer(frame.StreamID)
		if peer == nil {
			enqueue(ahpmux.Marshal(MuxFrame{
				Type:     MuxFrameClose,
				StreamID: frame.StreamID,
				Reason:   "Mux stream is not open",
			}))
			return nil
		}
		response, notification := h.handlePeer(peer, frame.Payload)
		for _, message := range [][]byte{response, notification} {
			if len(message) != 0 {
				enqueueMuxData(enqueue, frame.StreamID, message)
			}
		}
	case MuxFrameClose:
		h.removeMuxPeer(frame.StreamID)
	}
	return nil
}

func (h *Host) addMuxPeer(streamID string, enqueue func([]byte)) (*logicalPeer, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.peers[streamID]; exists {
		return nil, fmt.Errorf("Mux stream already exists")
	}
	if len(h.peers)-1 >= maxLogicalPeers {
		return nil, fmt.Errorf("Agent Host logical peer limit reached")
	}
	peer := newLogicalPeer(streamID)
	peer.emit = func(payload []byte) {
		enqueueMuxData(enqueue, streamID, payload)
	}
	h.peers[streamID] = peer
	return peer, nil
}

func (h *Host) muxPeer(streamID string) *logicalPeer {
	h.mu.Lock()
	defer h.mu.Unlock()
	if streamID == h.directPeer.id {
		return nil
	}
	return h.peers[streamID]
}

func (h *Host) removeMuxPeer(streamID string) {
	h.mu.Lock()
	delete(h.peers, streamID)
	h.mu.Unlock()
}

func (h *Host) removeAllMuxPeers() {
	h.mu.Lock()
	for id := range h.peers {
		if id != h.directPeer.id {
			delete(h.peers, id)
		}
	}
	h.mu.Unlock()
}

func enqueueMuxData(enqueue func([]byte), streamID string, payload []byte) {
	enqueue(ahpmux.Marshal(MuxFrame{
		Type:     MuxFrameData,
		StreamID: streamID,
		Payload:  json.RawMessage(payload),
	}))
}

type MuxTransport struct {
	streamID string
	send     func(context.Context, MuxFrame) error
	incoming chan ahp.TransportMessage
	done     chan struct{}
	once     sync.Once
}

func NewMuxTransport(
	streamID string,
	send func(context.Context, MuxFrame) error,
) *MuxTransport {
	return &MuxTransport{
		streamID: streamID,
		send:     send,
		incoming: make(chan ahp.TransportMessage, 64),
		done:     make(chan struct{}),
	}
}

func (t *MuxTransport) Send(ctx context.Context, message ahp.TransportMessage) error {
	payload, isBinary, err := message.Bytes()
	if err != nil {
		return err
	}
	if isBinary {
		return fmt.Errorf("AHP Mux only supports JSON text messages")
	}
	return t.send(ctx, MuxFrame{
		Type:     MuxFrameData,
		StreamID: t.streamID,
		Payload:  json.RawMessage(payload),
	})
}

func (t *MuxTransport) Recv(ctx context.Context) (ahp.TransportMessage, error) {
	select {
	case message := <-t.incoming:
		return message, nil
	case <-ctx.Done():
		return ahp.TransportMessage{}, ctx.Err()
	case <-t.done:
		return ahp.TransportMessage{}, ahp.ErrClosed
	}
}

func (t *MuxTransport) Accept(ctx context.Context, frame MuxFrame) error {
	if err := frame.Validate(); err != nil {
		return err
	}
	if frame.Type != MuxFrameData || frame.StreamID != t.streamID {
		return fmt.Errorf("Mux frame does not belong to transport %q", t.streamID)
	}
	select {
	case t.incoming <- ahp.NewTextMessage(string(frame.Payload)):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-t.done:
		return ahp.ErrClosed
	}
}

func (t *MuxTransport) Close(ctx context.Context) error {
	var sendErr error
	t.once.Do(func() {
		close(t.done)
		sendErr = t.send(ctx, MuxFrame{Type: MuxFrameClose, StreamID: t.streamID})
	})
	return sendErr
}

var _ ahp.Transport = (*MuxTransport)(nil)
