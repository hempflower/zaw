package httptransport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zaw-dev/zaw/internal/ahpmux"
	storage "github.com/zaw-dev/zaw/internal/infra/persistence/gormstore"
	"gorm.io/gorm"
)

var ahpUpgrader = websocket.Upgrader{
	CheckOrigin: func(request *http.Request) bool {
		origin := request.Header.Get("Origin")
		// Native Agent Hosts do not send Origin. Browser clients must be same-origin
		// so a third-party page cannot attach to a user's Workspace WebSocket.
		if origin == "" {
			return true
		}
		parsed, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return parsed.Host == request.Host &&
			(parsed.Scheme == "http" || parsed.Scheme == "https")
	},
}

type ahpGateway struct {
	mu    sync.Mutex
	hosts map[string]*ahpHostConnection
}

type ahpHostConnection struct {
	connection *websocket.Conn
	done       chan struct{}
	writeQueue chan ahpmux.Frame
	mu         sync.Mutex
	streams    map[string]*ahpStream
	nextStream atomic.Uint64
	closeOnce  sync.Once
}

type webSocketFrame struct {
	payload []byte
}

type ahpStream struct {
	id        string
	host      *ahpHostConnection
	frames    chan webSocketFrame
	opened    chan error
	done      chan struct{}
	closeOnce sync.Once
}

const (
	maxAHPStreams        = 16
	ahpStreamQueueSize   = 64
	ahpHostWriteQueue    = 256
	ahpStreamOpenTimeout = 3 * time.Second
)

func newAHPGateway() *ahpGateway {
	return &ahpGateway{hosts: make(map[string]*ahpHostConnection)}
}

func (g *ahpGateway) closeAll() {
	g.mu.Lock()
	hosts := make([]*ahpHostConnection, 0, len(g.hosts))
	for _, host := range g.hosts {
		hosts = append(hosts, host)
	}
	g.hosts = make(map[string]*ahpHostConnection)
	g.mu.Unlock()
	for _, host := range hosts {
		host.close()
	}
}

func (s *Server) agentHostAHP(w http.ResponseWriter, r *http.Request) {
	workspaceID := routeParam(r, "workspaceID")
	if err := s.authenticateAgentHost(r, workspaceID); err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	if err := s.acceptAgentHost(workspaceID); err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	connection, err := ahpUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	host := &ahpHostConnection{
		connection: connection,
		done:       make(chan struct{}),
		writeQueue: make(chan ahpmux.Frame, ahpHostWriteQueue),
		streams:    make(map[string]*ahpStream),
	}
	if previous := s.ahp.register(workspaceID, host); previous != nil {
		previous.closeWithReason("replaced by a newer Agent Host connection")
	}
	defer s.ahp.unregister(workspaceID, host)
	go host.writeFrames()
	if s.sessions != nil {
		go s.watchSessionCatalog(workspaceID, host)
	}
	s.ahp.readHost(host)
}

func (s *Server) acceptAgentHost(workspaceID string) error {
	if s.db == nil {
		return nil
	}
	var workspace storage.Workspace
	err := s.db.Select("desired_state").Where("id = ?", workspaceID).First(&workspace).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("workspace does not exist")
	}
	if err != nil {
		return fmt.Errorf("read workspace state: %w", err)
	}
	if workspace.DesiredState != "running" {
		return fmt.Errorf("workspace is not running")
	}
	return nil
}

func (s *Server) workspaceAHP(w http.ResponseWriter, r *http.Request) {
	workspaceID := routeParam(r, "workspaceID")
	host, err := s.ahp.host(workspaceID)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	client, err := ahpUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	stream, err := host.openStream(r.Context())
	if err != nil {
		_ = client.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, err.Error()),
			time.Now().Add(time.Second),
		)
		return
	}
	defer stream.close("Workbench disconnected")
	proxyAHP(client, stream)
}

func (g *ahpGateway) register(
	workspaceID string,
	host *ahpHostConnection,
) *ahpHostConnection {
	g.mu.Lock()
	defer g.mu.Unlock()
	previous := g.hosts[workspaceID]
	g.hosts[workspaceID] = host
	return previous
}

func (g *ahpGateway) unregister(workspaceID string, host *ahpHostConnection) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.hosts[workspaceID] == host {
		delete(g.hosts, workspaceID)
	}
}

func (g *ahpGateway) host(workspaceID string) (*ahpHostConnection, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	host, exists := g.hosts[workspaceID]
	if !exists {
		return nil, fmt.Errorf("workspace is offline")
	}
	return host, nil
}

func (g *ahpGateway) isOnline(workspaceID string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	_, exists := g.hosts[workspaceID]
	return exists
}

func (g *ahpGateway) isCurrent(
	workspaceID string,
	host *ahpHostConnection,
) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.hosts[workspaceID] == host
}

func (g *ahpGateway) disconnect(workspaceID string) {
	g.mu.Lock()
	host := g.hosts[workspaceID]
	if host != nil {
		delete(g.hosts, workspaceID)
	}
	g.mu.Unlock()
	if host != nil {
		host.closeWithReason("workspace is stopping")
	}
}

func (g *ahpGateway) readHost(host *ahpHostConnection) {
	defer host.close()
	for {
		messageType, payload, err := host.connection.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage {
			continue
		}
		var frame ahpmux.Frame
		if json.Unmarshal(payload, &frame) != nil || frame.Validate() != nil {
			host.closeWithReason("invalid AHP Mux frame")
			return
		}
		host.routeFrame(frame)
	}
}

func (h *ahpHostConnection) close() {
	h.closeOnce.Do(func() {
		close(h.done)
		_ = h.connection.Close()
		h.mu.Lock()
		streams := make([]*ahpStream, 0, len(h.streams))
		for _, stream := range h.streams {
			streams = append(streams, stream)
		}
		h.streams = make(map[string]*ahpStream)
		h.mu.Unlock()
		for _, stream := range streams {
			stream.remoteClose(fmt.Errorf("Agent Host disconnected"))
		}
	})
}

func (h *ahpHostConnection) closeWithReason(reason string) {
	_ = h.connection.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason),
		time.Now().Add(time.Second),
	)
	h.close()
}

func (h *ahpHostConnection) writeFrames() {
	for {
		select {
		case frame := <-h.writeQueue:
			if err := h.connection.WriteMessage(
				websocket.TextMessage,
				ahpmux.Marshal(frame),
			); err != nil {
				h.close()
				return
			}
		case <-h.done:
			return
		}
	}
}

func (h *ahpHostConnection) send(frame ahpmux.Frame) error {
	select {
	case h.writeQueue <- frame:
		return nil
	case <-h.done:
		return fmt.Errorf("Agent Host disconnected")
	default:
		return fmt.Errorf("Agent Host Mux write queue is full")
	}
}

func (h *ahpHostConnection) openStream(ctx context.Context) (*ahpStream, error) {
	h.mu.Lock()
	if len(h.streams) >= maxAHPStreams {
		h.mu.Unlock()
		return nil, fmt.Errorf("Agent Host logical stream limit reached")
	}
	id := strconv.FormatUint(h.nextStream.Add(1), 10)
	stream := &ahpStream{
		id:     id,
		host:   h,
		frames: make(chan webSocketFrame, ahpStreamQueueSize),
		opened: make(chan error, 1),
		done:   make(chan struct{}),
	}
	h.streams[id] = stream
	h.mu.Unlock()
	if err := h.send(ahpmux.Frame{Type: ahpmux.FrameOpen, StreamID: id}); err != nil {
		stream.remoteClose(err)
		return nil, err
	}
	openContext, cancel := context.WithTimeout(ctx, ahpStreamOpenTimeout)
	defer cancel()
	select {
	case err := <-stream.opened:
		if err != nil {
			stream.remoteClose(err)
			return nil, err
		}
		return stream, nil
	case <-openContext.Done():
		stream.close("Mux stream open timed out")
		return nil, openContext.Err()
	case <-h.done:
		return nil, fmt.Errorf("Agent Host disconnected")
	}
}

func (h *ahpHostConnection) routeFrame(frame ahpmux.Frame) {
	h.mu.Lock()
	stream := h.streams[frame.StreamID]
	h.mu.Unlock()
	if stream == nil {
		return
	}
	switch frame.Type {
	case ahpmux.FrameOpened:
		select {
		case stream.opened <- nil:
		default:
		}
	case ahpmux.FrameData:
		select {
		case stream.frames <- webSocketFrame{payload: frame.Payload}:
		case <-stream.done:
		default:
			stream.close("Mux stream receive queue is full")
		}
	case ahpmux.FrameClose:
		stream.remoteClose(fmt.Errorf("Agent Host closed stream: %s", frame.Reason))
	}
}

func (s *ahpStream) close(reason string) {
	s.closeOnce.Do(func() {
		s.host.mu.Lock()
		delete(s.host.streams, s.id)
		s.host.mu.Unlock()
		close(s.done)
		_ = s.host.send(ahpmux.Frame{
			Type:     ahpmux.FrameClose,
			StreamID: s.id,
			Reason:   reason,
		})
	})
}

func (s *ahpStream) remoteClose(err error) {
	s.closeOnce.Do(func() {
		s.host.mu.Lock()
		delete(s.host.streams, s.id)
		s.host.mu.Unlock()
		select {
		case s.opened <- err:
		default:
		}
		close(s.done)
	})
}

func proxyAHP(client *websocket.Conn, stream *ahpStream) {
	defer client.Close()
	clientDone := make(chan struct{})
	go forwardClientFrames(client, stream, clientDone)
	for {
		select {
		case frame := <-stream.frames:
			if err := client.WriteMessage(websocket.TextMessage, frame.payload); err != nil {
				return
			}
		case <-stream.done:
			return
		case <-clientDone:
			return
		}
	}
}

func forwardClientFrames(client *websocket.Conn, stream *ahpStream, done chan<- struct{}) {
	defer close(done)
	for {
		messageType, payload, err := client.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage {
			continue
		}
		if err := stream.host.send(ahpmux.Frame{
			Type:     ahpmux.FrameData,
			StreamID: stream.id,
			Payload:  json.RawMessage(payload),
		}); err != nil {
			stream.close("Agent Host write failed")
			return
		}
	}
}
