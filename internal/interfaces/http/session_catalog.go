package httptransport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/microsoft/agent-host-protocol/clients/go/ahp"
	"github.com/microsoft/agent-host-protocol/clients/go/ahptypes"
	"github.com/zaw-dev/zaw/internal/ahpmux"
	domainsession "github.com/zaw-dev/zaw/internal/domain/session"
	sessionservice "github.com/zaw-dev/zaw/internal/usecase/session"
)

const catalogRetryDelay = time.Second

type ahpStreamTransport struct {
	stream *ahpStream
}

type sessionCatalogItem struct {
	WorkspaceID      string                 `json:"workspaceId"`
	Resource         string                 `json:"resource"`
	Provider         string                 `json:"provider"`
	Title            string                 `json:"title"`
	Status           uint32                 `json:"status"`
	Activity         string                 `json:"activity,omitempty"`
	WorkingDirectory string                 `json:"workingDirectory,omitempty"`
	Changes          *sessionCatalogChanges `json:"changes,omitempty"`
	CreatedAt        time.Time              `json:"createdAt"`
	ModifiedAt       time.Time              `json:"modifiedAt"`
	ObservedAt       time.Time              `json:"observedAt"`
	AgentHostOnline  bool                   `json:"agentHostOnline"`
	Stale            bool                   `json:"stale"`
}

type sessionCatalogChanges struct {
	Additions *int64 `json:"additions,omitempty"`
	Deletions *int64 `json:"deletions,omitempty"`
	Files     *int64 `json:"files,omitempty"`
}

type sessionCatalogResponse struct {
	Items      []sessionCatalogItem `json:"items"`
	NextCursor string               `json:"nextCursor,omitempty"`
}

func (t *ahpStreamTransport) Send(
	ctx context.Context,
	message ahp.TransportMessage,
) error {
	payload, binary, err := message.Bytes()
	if err != nil {
		return err
	}
	if binary {
		return fmt.Errorf("AHP Mux only accepts JSON text messages")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	return t.stream.host.send(ahpmux.Frame{
		Type:     ahpmux.FrameData,
		StreamID: t.stream.id,
		Payload:  json.RawMessage(payload),
	})
}

func (t *ahpStreamTransport) Recv(
	ctx context.Context,
) (ahp.TransportMessage, error) {
	select {
	case frame := <-t.stream.frames:
		return ahp.NewTextMessage(string(frame.payload)), nil
	case <-ctx.Done():
		return ahp.TransportMessage{}, ctx.Err()
	case <-t.stream.done:
		return ahp.TransportMessage{}, ahp.ErrClosed
	}
}

func (t *ahpStreamTransport) Close(context.Context) error {
	t.stream.close("server catalog client closed")
	return nil
}

func (s *Server) watchSessionCatalog(
	workspaceID string,
	host *ahpHostConnection,
) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-host.done:
			cancel()
		case <-ctx.Done():
		}
	}()
	for ctx.Err() == nil && s.ahp.isCurrent(workspaceID, host) {
		err := s.syncSessionCatalog(ctx, workspaceID, host)
		if ctx.Err() != nil || !s.ahp.isCurrent(workspaceID, host) {
			return
		}
		s.logger.Warn(
			"session catalog logical peer stopped",
			"workspace_id",
			workspaceID,
			"error",
			err,
		)
		select {
		case <-time.After(catalogRetryDelay):
		case <-ctx.Done():
			return
		}
	}
}

func (s *Server) syncSessionCatalog(
	ctx context.Context,
	workspaceID string,
	host *ahpHostConnection,
) error {
	stream, err := host.openStream(ctx)
	if err != nil {
		return err
	}
	client, err := ahp.Connect(ctx, &ahpStreamTransport{stream: stream}, ahp.DefaultConfig())
	if err != nil {
		stream.close("catalog client failed to connect")
		return err
	}
	defer client.Shutdown(context.Background())
	subscription := client.AttachSubscription(ahptypes.RootResourceURI)
	defer subscription.Close()
	_, err = client.Initialize(
		ctx,
		"zaw-server-catalog",
		ahptypes.SupportedProtocolVersions(),
		[]string{ahptypes.RootResourceURI},
	)
	if err != nil {
		return err
	}
	var result ahptypes.ListSessionsResult
	err = client.Request(ctx, "listSessions", ahptypes.ListSessionsParams{
		Channel: ahptypes.RootResourceURI,
	}, &result)
	if err != nil {
		return err
	}
	observedAt := time.Now().UTC()
	known := make(map[string]domainsession.Summary, len(result.Items))
	items := make([]domainsession.Summary, 0, len(result.Items))
	for _, summary := range result.Items {
		item, convertErr := catalogSummary(workspaceID, summary, observedAt)
		if convertErr != nil {
			return convertErr
		}
		known[item.Resource] = item
		items = append(items, item)
	}
	if !s.ahp.isCurrent(workspaceID, host) {
		return fmt.Errorf("Agent Host connection was replaced")
	}
	if err := s.sessions.ReplaceWorkspace(ctx, workspaceID, items); err != nil {
		return err
	}
	for {
		select {
		case event, ok := <-subscription.Events():
			if !ok {
				return ahp.ErrClosed
			}
			if err := s.applyCatalogEvent(ctx, workspaceID, host, known, event); err != nil {
				return err
			}
		case <-client.Done():
			return client.Err()
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (s *Server) applyCatalogEvent(
	ctx context.Context,
	workspaceID string,
	host *ahpHostConnection,
	known map[string]domainsession.Summary,
	event ahp.SubscriptionEvent,
) error {
	if !s.ahp.isCurrent(workspaceID, host) {
		return fmt.Errorf("Agent Host connection was replaced")
	}
	now := time.Now().UTC()
	switch current := event.(type) {
	case ahp.SubscriptionEventSessionAdded:
		item, err := catalogSummary(workspaceID, current.Params.Summary, now)
		if err != nil {
			return err
		}
		known[item.Resource] = item
		return s.sessions.Upsert(ctx, item)
	case ahp.SubscriptionEventSessionRemoved:
		resource := string(current.Params.Session)
		delete(known, resource)
		return s.sessions.Remove(ctx, workspaceID, resource)
	case ahp.SubscriptionEventSessionSummaryChanged:
		resource := string(current.Params.Session)
		item, exists := known[resource]
		if !exists {
			return nil
		}
		applyCatalogChanges(&item, current.Params.Changes)
		item.ObservedAt = now
		known[resource] = item
		return s.sessions.Upsert(ctx, item)
	default:
		return nil
	}
}

func catalogSummary(
	workspaceID string,
	summary ahptypes.SessionSummary,
	observedAt time.Time,
) (domainsession.Summary, error) {
	createdAt, err := time.Parse(time.RFC3339Nano, summary.CreatedAt)
	if err != nil {
		return domainsession.Summary{}, fmt.Errorf("parse session createdAt: %w", err)
	}
	modifiedAt, err := time.Parse(time.RFC3339Nano, summary.ModifiedAt)
	if err != nil {
		return domainsession.Summary{}, fmt.Errorf("parse session modifiedAt: %w", err)
	}
	workingDirectory := ""
	if summary.WorkingDirectory != nil {
		workingDirectory = string(*summary.WorkingDirectory)
	}
	activity := ""
	if summary.Activity != nil {
		activity = *summary.Activity
	}
	item := domainsession.Summary{
		WorkspaceID:      workspaceID,
		Resource:         string(summary.Resource),
		Provider:         summary.Provider,
		Title:            summary.Title,
		Status:           uint32(summary.Status),
		Activity:         activity,
		WorkingDirectory: workingDirectory,
		CreatedAt:        createdAt,
		ModifiedAt:       modifiedAt,
		ObservedAt:       observedAt,
	}
	if summary.Changes != nil {
		item.Changes = &domainsession.Changes{
			Additions: summary.Changes.Additions,
			Deletions: summary.Changes.Deletions,
			Files:     summary.Changes.Files,
		}
	}
	return item, nil
}

func applyCatalogChanges(
	item *domainsession.Summary,
	changes ahptypes.PartialSessionSummary,
) {
	if changes.Provider != nil {
		item.Provider = *changes.Provider
	}
	if changes.Title != nil {
		item.Title = *changes.Title
	}
	if changes.Status != nil {
		item.Status = uint32(*changes.Status)
	}
	if changes.Activity != nil {
		item.Activity = *changes.Activity
	}
	if changes.WorkingDirectory != nil {
		item.WorkingDirectory = string(*changes.WorkingDirectory)
	}
	if changes.ModifiedAt != nil {
		if value, err := time.Parse(time.RFC3339Nano, *changes.ModifiedAt); err == nil {
			item.ModifiedAt = value
		}
	}
	if changes.Changes != nil {
		item.Changes = &domainsession.Changes{
			Additions: changes.Changes.Additions,
			Deletions: changes.Changes.Deletions,
			Files:     changes.Changes.Files,
		}
	}
}

func (s *Server) sessionCatalog(w http.ResponseWriter, r *http.Request) {
	if s.sessions == nil {
		fail(w, http.StatusServiceUnavailable, "session catalog is unavailable")
		return
	}
	limit, err := parseSessionLimit(r.URL.Query().Get("limit"))
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	updatedAfter, err := parseUpdatedAfter(r.URL.Query().Get("updated_after"))
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	page, err := s.sessions.List(
		r.Context(),
		limit,
		r.URL.Query().Get("cursor"),
		updatedAfter,
	)
	if err != nil {
		if errors.Is(err, sessionservice.ErrInvalidCursor) {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger.Error("list session catalog", "error", err)
		fail(w, http.StatusInternalServerError, "session catalog query failed")
		return
	}
	response := sessionCatalogResponse{
		Items:      make([]sessionCatalogItem, 0, len(page.Items)),
		NextCursor: page.NextCursor,
	}
	for _, item := range page.Items {
		online := s.ahp.isOnline(item.WorkspaceID)
		view := sessionCatalogItem{
			WorkspaceID:      item.WorkspaceID,
			Resource:         item.Resource,
			Provider:         item.Provider,
			Title:            item.Title,
			Status:           item.Status,
			Activity:         item.Activity,
			WorkingDirectory: item.WorkingDirectory,
			CreatedAt:        item.CreatedAt,
			ModifiedAt:       item.ModifiedAt,
			ObservedAt:       item.ObservedAt,
			AgentHostOnline:  online,
			Stale:            !online,
		}
		if item.Changes != nil {
			view.Changes = &sessionCatalogChanges{
				Additions: item.Changes.Additions,
				Deletions: item.Changes.Deletions,
				Files:     item.Changes.Files,
			}
		}
		response.Items = append(response.Items, view)
	}
	etag := catalogETag(response)
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	respond(w, http.StatusOK, response)
}

func parseSessionLimit(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return 0, fmt.Errorf("limit must be a positive integer")
	}
	return limit, nil
}

func parseUpdatedAfter(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, fmt.Errorf("updated_after must be an RFC 3339 timestamp")
	}
	return &parsed, nil
}

func catalogETag(response sessionCatalogResponse) string {
	payload, _ := json.Marshal(response)
	digest := sha256.Sum256(payload)
	return `"` + hex.EncodeToString(digest[:]) + `"`
}

var _ ahp.Transport = (*ahpStreamTransport)(nil)
