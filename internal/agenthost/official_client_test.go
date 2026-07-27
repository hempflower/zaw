package agenthost

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/microsoft/agent-host-protocol/clients/go/ahp"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/agenthost/agentsdk"
)

func TestOfficialAHPClientOwnsRequestsAndSubscriptionDispatch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	host := New()
	transport := newHostClientTransport(host)
	client, err := ahp.Connect(ctx, transport, ahp.DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Shutdown(context.Background())
	initialized, err := client.Initialize(
		ctx,
		"official-go-client-test",
		ahptypes.SupportedProtocolVersions(),
		[]string{ahptypes.RootResourceURI},
	)
	if err != nil {
		t.Fatal(err)
	}
	if initialized.ProtocolVersion != ahptypes.ProtocolVersion {
		t.Fatalf(
			"protocol version = %q, want %q",
			initialized.ProtocolVersion,
			ahptypes.ProtocolVersion,
		)
	}
	if len(initialized.Snapshots) != 1 || initialized.Snapshots[0].State.Root == nil {
		t.Fatalf("initialize did not return the requested Root snapshot: %+v", initialized.Snapshots)
	}
	if err := client.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	reconnected, err := client.Reconnect(
		ctx,
		"official-go-client-test",
		initialized.ServerSeq,
		[]string{ahptypes.RootResourceURI},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reconnected.Value.(*ahptypes.ReconnectSnapshotResult); !ok {
		t.Fatalf("reconnect result type = %T", reconnected.Value)
	}
	subscription := client.AttachSubscription(ahptypes.RootResourceURI)
	defer subscription.Close()
	host.emitRootTerminalsChanged()
	select {
	case event := <-subscription.Events():
		if _, ok := event.(ahp.SubscriptionEventAction); !ok {
			t.Fatalf("subscription event type = %T", event)
		}
	case <-ctx.Done():
		t.Fatalf("official client did not dispatch the Host action: %v", ctx.Err())
	}
}

func TestOfficialAHPClientRunsChatAndRecoversFromSnapshots(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	host := NewWithAgent(&streamingTestRuntime{}, "/workspace")
	client, err := ahp.Connect(ctx, newHostClientTransport(host), ahp.DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	initialized, err := client.Initialize(
		ctx,
		"standard-flow-client",
		ahptypes.SupportedProtocolVersions(),
		[]string{ahptypes.RootResourceURI},
	)
	if err != nil {
		t.Fatal(err)
	}
	rootSubscription := client.AttachSubscription(ahptypes.RootResourceURI)
	defer rootSubscription.Close()
	sessionURI := ahptypes.URI("ahp-session:/standard-flow")
	if err := client.Request(ctx, "createSession", ahptypes.CreateSessionParams{
		Channel: sessionURI,
	}, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-rootSubscription.Events():
		added, ok := event.(ahp.SubscriptionEventSessionAdded)
		if !ok || added.Params.Summary.Resource != sessionURI {
			t.Fatalf("unexpected Root session event: %+v", event)
		}
	case <-ctx.Done():
		t.Fatal("standard root/sessionAdded notification was not received")
	}
	var listed ahptypes.ListSessionsResult
	if err := client.Request(ctx, "listSessions", ahptypes.ListSessionsParams{
		Channel: ahptypes.RootResourceURI,
	}, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Items) != 1 || listed.Items[0].Resource != sessionURI {
		t.Fatalf("unexpected session catalogue: %+v", listed.Items)
	}
	sessionResult, sessionSubscription, err := client.Subscribe(ctx, string(sessionURI))
	if err != nil {
		t.Fatal(err)
	}
	defer sessionSubscription.Close()
	if sessionResult.Snapshot == nil || sessionResult.Snapshot.State.Session == nil {
		t.Fatalf("missing standard Session snapshot: %+v", sessionResult)
	}
	if len(sessionResult.Snapshot.State.Session.Changesets) != 1 {
		t.Fatalf("missing standard Changeset catalogue: %+v", sessionResult.Snapshot.State.Session)
	}
	changesetURI := sessionResult.Snapshot.State.Session.Changesets[0].UriTemplate
	changesetResult, changesetSubscription, err := client.Subscribe(ctx, changesetURI)
	if err != nil {
		t.Fatal(err)
	}
	defer changesetSubscription.Close()
	if changesetResult.Snapshot == nil || changesetResult.Snapshot.State.Changeset == nil {
		t.Fatalf("missing standard Changeset snapshot: %+v", changesetResult)
	}
	if err := client.Request(ctx, "workspaceChanges", map[string]string{
		"channel": ahptypes.RootResourceURI,
	}, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-changesetSubscription.Events():
		actionEvent, ok := event.(ahp.SubscriptionEventAction)
		if !ok {
			t.Fatalf("unexpected Changeset event: %T", event)
		}
		if _, ok := actionEvent.Envelope.Action.Value.(*ahptypes.ChangesetContentChangedAction); !ok {
			t.Fatalf("unexpected Changeset action: %T", actionEvent.Envelope.Action.Value)
		}
	case <-ctx.Done():
		t.Fatal("standard Changeset action was not received")
	}
	chatURI := *sessionResult.Snapshot.State.Session.DefaultChat
	chatResult, chatSubscription, err := client.Subscribe(ctx, string(chatURI))
	if err != nil {
		t.Fatal(err)
	}
	defer chatSubscription.Close()
	if chatResult.Snapshot == nil || chatResult.Snapshot.State.Chat == nil {
		t.Fatalf("missing standard Chat snapshot: %+v", chatResult)
	}
	turn := newUserTurn("hello AHP")
	_, err = client.Dispatch(
		ctx,
		string(chatURI),
		ahptypes.StateAction{Value: &turn},
	)
	if err != nil {
		t.Fatal(err)
	}
	wantActions := map[ahptypes.ActionType]bool{
		ahptypes.ActionTypeChatTurnStarted:  false,
		ahptypes.ActionTypeChatResponsePart: false,
		ahptypes.ActionTypeChatDelta:        false,
		ahptypes.ActionTypeChatTurnComplete: false,
	}
	for !allActionsReceived(wantActions) {
		select {
		case event := <-chatSubscription.Events():
			actionEvent, ok := event.(ahp.SubscriptionEventAction)
			if !ok {
				continue
			}
			wantActions[actionType(actionEvent.Envelope.Action)] = true
		case <-ctx.Done():
			t.Fatalf("standard streaming actions were incomplete: %+v", wantActions)
		}
	}
	select {
	case event := <-sessionSubscription.Events():
		actionEvent, ok := event.(ahp.SubscriptionEventAction)
		if !ok {
			t.Fatalf("unexpected Session event: %T", event)
		}
		if _, ok := actionEvent.Envelope.Action.Value.(*ahptypes.SessionChatUpdatedAction); !ok {
			t.Fatalf("unexpected Session action: %T", actionEvent.Envelope.Action.Value)
		}
	case <-ctx.Done():
		t.Fatal("standard Session action was not received")
	}
	select {
	case event := <-rootSubscription.Events():
		changed, ok := event.(ahp.SubscriptionEventSessionSummaryChanged)
		if !ok || changed.Params.Session != sessionURI || changed.Params.Changes.Status == nil {
			t.Fatalf("unexpected Root summary event: %+v", event)
		}
	case <-ctx.Done():
		t.Fatal("standard Root sessionSummaryChanged notification was not received")
	}
	if err := client.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	reconnectedClient, err := ahp.Connect(
		ctx,
		newHostClientTransport(host),
		ahp.DefaultConfig(),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer reconnectedClient.Shutdown(context.Background())
	reconnected, err := reconnectedClient.Reconnect(
		ctx,
		"standard-flow-client",
		initialized.ServerSeq,
		[]string{
			ahptypes.RootResourceURI,
			string(sessionURI),
			string(chatURI),
			changesetURI,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshotResult, ok := reconnected.Value.(*ahptypes.ReconnectSnapshotResult)
	if !ok || len(snapshotResult.Snapshots) != 4 {
		t.Fatalf("unexpected reconnect result: %+v", reconnected.Value)
	}
	recoveredChat := snapshotByResource(snapshotResult.Snapshots, chatURI).State.Chat
	if recoveredChat == nil || recoveredChat.ActiveTurn != nil || len(recoveredChat.Turns) != 1 {
		t.Fatalf("Chat state was not recovered from a fresh snapshot: %+v", recoveredChat)
	}
}

func TestOfficialAHPClientConfirmsAgentSDKToolPermission(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	runtime := &permissionTestRuntime{decisions: make(chan agentsdk.PermissionDecision, 1)}
	host := NewWithAgent(runtime, "/workspace")
	client, err := ahp.Connect(ctx, newHostClientTransport(host), ahp.DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Shutdown(context.Background())
	if _, err := client.Initialize(
		ctx,
		"permission-client",
		ahptypes.SupportedProtocolVersions(),
		[]string{ahptypes.RootResourceURI},
	); err != nil {
		t.Fatal(err)
	}
	sessionURI := ahptypes.URI("ahp-session:/permission-flow")
	if err := client.Request(ctx, "createSession", ahptypes.CreateSessionParams{
		Channel: sessionURI,
	}, nil); err != nil {
		t.Fatal(err)
	}
	sessionResult, sessionSubscription, err := client.Subscribe(ctx, string(sessionURI))
	if err != nil {
		t.Fatal(err)
	}
	defer sessionSubscription.Close()
	chatURI := *sessionResult.Snapshot.State.Session.DefaultChat
	_, chatSubscription, err := client.Subscribe(ctx, string(chatURI))
	if err != nil {
		t.Fatal(err)
	}
	defer chatSubscription.Close()
	turn := newUserTurn("run a tool")
	if _, err := client.Dispatch(
		ctx,
		string(chatURI),
		ahptypes.StateAction{Value: &turn},
	); err != nil {
		t.Fatal(err)
	}
	var ready *ahptypes.ChatToolCallReadyAction
	for ready == nil {
		select {
		case event := <-chatSubscription.Events():
			action, ok := event.(ahp.SubscriptionEventAction)
			if !ok {
				continue
			}
			ready, _ = action.Envelope.Action.Value.(*ahptypes.ChatToolCallReadyAction)
		case <-ctx.Done():
			t.Fatal("standard tool confirmation was not received")
		}
	}
	confirmed := ahptypes.ChatToolCallConfirmedAction{
		Type:       ahptypes.ActionTypeChatToolCallConfirmed,
		TurnId:     ready.TurnId,
		ToolCallId: ready.ToolCallId,
		Approved:   true,
	}
	if _, err := client.Dispatch(
		ctx,
		string(chatURI),
		ahptypes.StateAction{Value: &confirmed},
	); err != nil {
		t.Fatal(err)
	}
	select {
	case decision := <-runtime.decisions:
		if decision != agentsdk.PermissionAllowOnce {
			t.Fatalf("permission decision = %q", decision)
		}
	case <-ctx.Done():
		t.Fatal("Agent SDK permission callback was not resumed")
	}
	host.mu.Lock()
	inputNeeded := host.sessions[string(sessionURI)].State.InputNeeded
	host.mu.Unlock()
	if len(inputNeeded) != 0 {
		t.Fatalf("resolved permission remained in Session inputNeeded: %+v", inputNeeded)
	}
}

func snapshotByResource(
	snapshots []ahptypes.Snapshot,
	resource ahptypes.URI,
) ahptypes.Snapshot {
	for _, snapshot := range snapshots {
		if snapshot.Resource == resource {
			return snapshot
		}
	}
	return ahptypes.Snapshot{}
}

func allActionsReceived(actions map[ahptypes.ActionType]bool) bool {
	for _, received := range actions {
		if !received {
			return false
		}
	}
	return true
}

func actionType(action ahptypes.StateAction) ahptypes.ActionType {
	switch value := action.Value.(type) {
	case *ahptypes.ChatTurnStartedAction:
		return value.Type
	case *ahptypes.ChatResponsePartAction:
		return value.Type
	case *ahptypes.ChatDeltaAction:
		return value.Type
	case *ahptypes.ChatTurnCompleteAction:
		return value.Type
	default:
		return ""
	}
}

type streamingTestRuntime struct{}

func (r *streamingTestRuntime) CreateSession(
	_ context.Context,
	options agentsdk.SessionOptions,
) (agentsdk.Session, error) {
	return &streamingTestSession{options: options}, nil
}

func (r *streamingTestRuntime) Close() error { return nil }

type streamingTestSession struct {
	options agentsdk.SessionOptions
}

func (s *streamingTestSession) ID() string { return s.options.ID }

func (s *streamingTestSession) Prompt(
	_ context.Context,
	_ agentsdk.PromptRequest,
) error {
	s.options.OnEvent(agentsdk.Event{
		Type: "assistant.message_delta",
		Data: map[string]string{"text": "hello from the Agent SDK"},
	})
	s.options.OnEvent(agentsdk.Event{Type: "session.idle"})
	return nil
}

func (s *streamingTestSession) Cancel(context.Context) error { return nil }
func (s *streamingTestSession) Close() error                 { return nil }

type permissionTestRuntime struct {
	decisions chan agentsdk.PermissionDecision
}

func (r *permissionTestRuntime) CreateSession(
	_ context.Context,
	options agentsdk.SessionOptions,
) (agentsdk.Session, error) {
	return &permissionTestSession{options: options, decisions: r.decisions}, nil
}

func (r *permissionTestRuntime) Close() error { return nil }

type permissionTestSession struct {
	options   agentsdk.SessionOptions
	decisions chan agentsdk.PermissionDecision
}

func (s *permissionTestSession) ID() string { return s.options.ID }

func (s *permissionTestSession) Prompt(
	ctx context.Context,
	_ agentsdk.PromptRequest,
) error {
	decision := s.options.OnPermission(ctx, agentsdk.PermissionRequest{
		Kind: "shell",
		Data: []byte(`{"command":"echo ready"}`),
	})
	s.decisions <- decision
	return nil
}

func (s *permissionTestSession) Cancel(context.Context) error { return nil }
func (s *permissionTestSession) Close() error                 { return nil }

type hostClientTransport struct {
	host     *Host
	incoming chan ahp.TransportMessage
	done     chan struct{}
}

func newHostClientTransport(host *Host) *hostClientTransport {
	transport := &hostClientTransport{
		host: host, incoming: make(chan ahp.TransportMessage, 16), done: make(chan struct{}),
	}
	host.setEmitter(func(payload []byte) {
		transport.incoming <- ahp.NewTextMessage(string(payload))
	})
	return transport
}

func (t *hostClientTransport) Send(
	ctx context.Context,
	message ahp.TransportMessage,
) error {
	payload, _, err := message.Bytes()
	if err != nil {
		return err
	}
	response, notification := t.host.handle(payload)
	for _, frame := range [][]byte{response, notification} {
		if len(frame) == 0 {
			continue
		}
		select {
		case t.incoming <- ahp.NewTextMessage(string(frame)):
		case <-ctx.Done():
			return ctx.Err()
		case <-t.done:
			return ahp.ErrClosed
		}
	}
	return nil
}

func (t *hostClientTransport) Recv(
	ctx context.Context,
) (ahp.TransportMessage, error) {
	select {
	case message := <-t.incoming:
		return message, nil
	case <-ctx.Done():
		return ahp.TransportMessage{}, ctx.Err()
	case <-t.done:
		return ahp.TransportMessage{}, errors.Join(ahp.ErrClosed)
	}
}

func (t *hostClientTransport) Close(context.Context) error {
	select {
	case <-t.done:
	default:
		close(t.done)
	}
	return nil
}
