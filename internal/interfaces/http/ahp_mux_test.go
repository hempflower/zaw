package httptransport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zaw-dev/zaw/internal/ahpmux"
)

func TestAHPMuxIsolatesEqualJSONRPCIDsAndClientClose(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	baseURL := "ws" + strings.TrimPrefix(testServer.URL, "http")
	host := dialTestSocket(t, baseURL+"/api/v1/agent-hosts/workspace-1/ahp")
	defer host.Close()

	first := dialTestWorkspaceSocket(t, baseURL+"/api/v1/workspaces/workspace-1/ahp")
	firstOpen := readTestMuxFrame(t, host)
	acknowledgeTestStream(t, host, firstOpen)
	defer first.Close()
	second := dialTestWorkspaceSocket(t, baseURL+"/api/v1/workspaces/workspace-1/ahp")
	secondOpen := readTestMuxFrame(t, host)
	acknowledgeTestStream(t, host, secondOpen)
	defer second.Close()

	request := []byte(`{"jsonrpc":"2.0","id":7,"method":"ping","params":{}}`)
	if err := first.WriteMessage(websocket.TextMessage, request); err != nil {
		t.Fatal(err)
	}
	if err := second.WriteMessage(websocket.TextMessage, request); err != nil {
		t.Fatal(err)
	}
	firstRequest := readTestMuxFrame(t, host)
	secondRequest := readTestMuxFrame(t, host)
	streams := map[string]bool{
		firstRequest.StreamID:  true,
		secondRequest.StreamID: true,
	}
	if !streams[firstOpen.StreamID] || !streams[secondOpen.StreamID] || len(streams) != 2 {
		t.Fatalf("requests were not isolated by stream: %+v", streams)
	}
	writeTestMuxResult(t, host, secondRequest.StreamID, 7)
	writeTestMuxResult(t, host, firstRequest.StreamID, 7)
	assertTestMuxResult(t, first, firstOpen.StreamID)
	assertTestMuxResult(t, second, secondOpen.StreamID)

	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := second.WriteMessage(websocket.TextMessage, request); err != nil {
		t.Fatal(err)
	}
	for {
		frame := readTestMuxFrame(t, host)
		if frame.Type == ahpmux.FrameData {
			if frame.StreamID != secondOpen.StreamID {
				t.Fatalf("closed stream received data: %+v", frame)
			}
			writeTestMuxResult(t, host, frame.StreamID, 7)
			break
		}
	}
	assertTestMuxResult(t, second, secondOpen.StreamID)
}

func TestAHPMuxSlowStreamDoesNotBlockAnotherStream(t *testing.T) {
	host := &ahpHostConnection{
		done:       make(chan struct{}),
		writeQueue: make(chan ahpmux.Frame, 4),
		streams:    make(map[string]*ahpStream),
	}
	slow := &ahpStream{
		id:     "slow",
		host:   host,
		frames: make(chan webSocketFrame, 1),
		opened: make(chan error, 1),
		done:   make(chan struct{}),
	}
	fast := &ahpStream{
		id:     "fast",
		host:   host,
		frames: make(chan webSocketFrame, 1),
		opened: make(chan error, 1),
		done:   make(chan struct{}),
	}
	host.streams[slow.id] = slow
	host.streams[fast.id] = fast
	payload := json.RawMessage(`{"jsonrpc":"2.0","method":"action"}`)
	host.routeFrame(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: slow.id,
		Payload:  payload,
	})
	host.routeFrame(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: slow.id,
		Payload:  payload,
	})
	host.routeFrame(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: fast.id,
		Payload:  payload,
	})
	select {
	case <-slow.done:
	case <-time.After(time.Second):
		t.Fatal("slow stream was not isolated after queue overflow")
	}
	select {
	case frame := <-fast.frames:
		if string(frame.payload) != string(payload) {
			t.Fatalf("fast stream payload changed: %s", frame.payload)
		}
	case <-time.After(time.Second):
		t.Fatal("slow stream blocked the fast stream")
	}
}

func TestAgentHostDisconnectClosesAllMuxStreams(t *testing.T) {
	server := &Server{ahp: newAHPGateway()}
	testServer := httptest.NewServer(server.routes())
	defer testServer.Close()
	baseURL := "ws" + strings.TrimPrefix(testServer.URL, "http")
	host := dialTestSocket(t, baseURL+"/api/v1/agent-hosts/workspace-1/ahp")
	clients := make([]*websocket.Conn, 0, 2)
	for index := 0; index < 2; index++ {
		client := dialTestWorkspaceSocket(t, baseURL+"/api/v1/workspaces/workspace-1/ahp")
		open := readTestMuxFrame(t, host)
		acknowledgeTestStream(t, host, open)
		clients = append(clients, client)
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}
	for _, client := range clients {
		client.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := client.ReadMessage(); err == nil {
			t.Fatal("logical stream survived its Agent Host physical connection")
		}
		_ = client.Close()
	}
}

func dialTestSocket(t *testing.T, endpoint string) *websocket.Conn {
	t.Helper()
	connection, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	return connection
}

func dialTestWorkspaceSocket(t *testing.T, endpoint string) *websocket.Conn {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		connection, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
		if err == nil {
			return connection
		}
		if response != nil {
			_ = response.Body.Close()
			if response.StatusCode != http.StatusServiceUnavailable {
				t.Fatalf("connect Workbench AHP socket: %v", err)
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Agent Host did not register before deadline")
	return nil
}

func readTestMuxFrame(t *testing.T, connection *websocket.Conn) ahpmux.Frame {
	t.Helper()
	connection.SetReadDeadline(time.Now().Add(time.Second))
	_, payload, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var frame ahpmux.Frame
	if err := json.Unmarshal(payload, &frame); err != nil {
		t.Fatal(err)
	}
	return frame
}

func acknowledgeTestStream(t *testing.T, host *websocket.Conn, open ahpmux.Frame) {
	t.Helper()
	if open.Type != ahpmux.FrameOpen {
		t.Fatalf("expected open frame, got %+v", open)
	}
	if err := host.WriteMessage(websocket.TextMessage, ahpmux.Marshal(ahpmux.Frame{
		Type:     ahpmux.FrameOpened,
		StreamID: open.StreamID,
	})); err != nil {
		t.Fatal(err)
	}
}

func writeTestMuxResult(t *testing.T, host *websocket.Conn, streamID string, id int) {
	t.Helper()
	result, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  map[string]string{"streamId": streamID},
	})
	if err := host.WriteMessage(websocket.TextMessage, ahpmux.Marshal(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: streamID,
		Payload:  result,
	})); err != nil {
		t.Fatal(err)
	}
}

func assertTestMuxResult(t *testing.T, client *websocket.Conn, streamID string) {
	t.Helper()
	client.SetReadDeadline(time.Now().Add(time.Second))
	_, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Result struct {
			StreamID string `json:"streamId"`
		} `json:"result"`
	}
	if json.Unmarshal(payload, &response) != nil || response.Result.StreamID != streamID {
		t.Fatalf("response crossed streams: %s", payload)
	}
}
