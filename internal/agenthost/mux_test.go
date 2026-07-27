package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/microsoft/agent-host-protocol/clients/go/ahp"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
)

func TestMuxTransportImplementsAHPTransport(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	sent := make(chan MuxFrame, 2)
	transport := NewMuxTransport("stream-1", func(_ context.Context, frame MuxFrame) error {
		sent <- frame
		return nil
	})
	message := ahp.NewTextMessage(`{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if err := transport.Send(ctx, message); err != nil {
		t.Fatal(err)
	}
	if frame := <-sent; frame.Type != MuxFrameData || frame.StreamID != "stream-1" {
		t.Fatalf("unexpected outbound Mux frame: %+v", frame)
	}
	inbound := MuxFrame{
		Type:     MuxFrameData,
		StreamID: "stream-1",
		Payload:  json.RawMessage(`{"jsonrpc":"2.0","id":1,"result":{}}`),
	}
	if err := transport.Accept(ctx, inbound); err != nil {
		t.Fatal(err)
	}
	received, err := transport.Recv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := received.Bytes()
	if err != nil || !json.Valid(payload) {
		t.Fatalf("invalid inbound AHP message: %s", payload)
	}
	if err := transport.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if frame := <-sent; frame.Type != MuxFrameClose || frame.StreamID != "stream-1" {
		t.Fatalf("unexpected close frame: %+v", frame)
	}
}

func TestHostMuxPeersKeepSubscriptionsIndependent(t *testing.T) {
	host := New()
	frames := make(chan MuxFrame, 32)
	enqueue := func(payload []byte) {
		var frame MuxFrame
		if json.Unmarshal(payload, &frame) != nil {
			t.Errorf("invalid outbound Mux frame: %s", payload)
			return
		}
		frames <- frame
	}
	for _, streamID := range []string{"peer-a", "peer-b"} {
		if err := host.handleMuxFrame(marshalMuxFrameForTest(MuxFrame{
			Type:     MuxFrameOpen,
			StreamID: streamID,
		}), enqueue); err != nil {
			t.Fatal(err)
		}
		assertMuxFrameForStream(t, <-frames, MuxFrameOpened, streamID)
		request := map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "initialize",
			"params": ahptypes.InitializeParams{
				Channel:              ahptypes.RootResourceURI,
				ProtocolVersions:     ahptypes.SupportedProtocolVersions(),
				ClientId:             streamID,
				InitialSubscriptions: []string{ahptypes.RootResourceURI},
			},
		}
		if err := host.handleMuxFrame(marshalMuxFrameForTest(MuxFrame{
			Type:     MuxFrameData,
			StreamID: streamID,
			Payload:  marshalRaw(request),
		}), enqueue); err != nil {
			t.Fatal(err)
		}
		response := <-frames
		assertMuxFrameForStream(t, response, MuxFrameData, streamID)
		var rpc ahptypes.JsonRpcSuccessResponse
		if json.Unmarshal(response.Payload, &rpc) != nil || rpc.ID != 1 {
			t.Fatalf("JSON-RPC response crossed logical peers: %s", response.Payload)
		}
	}
	host.emitRootTerminalsChanged()
	first := <-frames
	second := <-frames
	if first.StreamID == second.StreamID {
		t.Fatalf("root action was not fanned out by logical peer: %+v %+v", first, second)
	}
	unsubscribe := map[string]any{
		"jsonrpc": "2.0",
		"method":  "unsubscribe",
		"params":  ahptypes.UnsubscribeParams{Channel: ahptypes.RootResourceURI},
	}
	if err := host.handleMuxFrame(marshalMuxFrameForTest(MuxFrame{
		Type:     MuxFrameData,
		StreamID: "peer-a",
		Payload:  marshalRaw(unsubscribe),
	}), enqueue); err != nil {
		t.Fatal(err)
	}
	host.emitRootTerminalsChanged()
	assertMuxFrameForStream(t, <-frames, MuxFrameData, "peer-b")
	select {
	case unexpected := <-frames:
		t.Fatalf("unsubscribed peer received an action: %+v", unexpected)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestHostMuxEnforcesLogicalPeerLimit(t *testing.T) {
	host := New()
	frames := make(chan MuxFrame, maxLogicalPeers+1)
	enqueue := func(payload []byte) {
		var frame MuxFrame
		_ = json.Unmarshal(payload, &frame)
		frames <- frame
	}
	for index := 0; index < maxLogicalPeers; index++ {
		streamID := fmt.Sprintf("peer-%d", index)
		if err := host.handleMuxFrame(marshalMuxFrameForTest(MuxFrame{
			Type:     MuxFrameOpen,
			StreamID: streamID,
		}), enqueue); err != nil {
			t.Fatal(err)
		}
		assertMuxFrameForStream(t, <-frames, MuxFrameOpened, streamID)
	}
	if err := host.handleMuxFrame(marshalMuxFrameForTest(MuxFrame{
		Type:     MuxFrameOpen,
		StreamID: "over-limit",
	}), enqueue); err != nil {
		t.Fatal(err)
	}
	rejected := <-frames
	assertMuxFrameForStream(t, rejected, MuxFrameClose, "over-limit")
	if rejected.Reason == "" {
		t.Fatal("peer limit rejection did not include a reason")
	}
}

func TestTerminalClientClaimIsScopedToLogicalPeer(t *testing.T) {
	host := New()
	first := newLogicalPeer("first")
	first.clientID = "client-a"
	second := newLogicalPeer("second")
	second.clientID = "client-b"
	claim := ahptypes.TerminalClaim{Value: &ahptypes.TerminalClientClaim{
		Kind:     ahptypes.TerminalClaimKindClient,
		ClientId: "client-a",
	}}
	if !validTerminalClaim(first, claim) || validTerminalClaim(second, claim) {
		t.Fatal("terminal claim validation crossed logical peers")
	}
	entry := &terminal{state: ahptypes.TerminalState{Claim: claim}}
	if !host.peerOwnsTerminal(first, entry) || host.peerOwnsTerminal(second, entry) {
		t.Fatal("terminal ownership crossed logical peers")
	}
}

func marshalMuxFrameForTest(frame MuxFrame) []byte {
	payload, _ := json.Marshal(frame)
	return payload
}

func assertMuxFrameForStream(
	t *testing.T,
	frame MuxFrame,
	wantType MuxFrameType,
	wantStream string,
) {
	t.Helper()
	if frame.Type != wantType || frame.StreamID != wantStream {
		t.Fatalf("Mux frame = %+v, want type %q stream %q", frame, wantType, wantStream)
	}
}
