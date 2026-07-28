package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
	llmservice "github.com/zaw-dev/zaw/internal/usecase/llm"
)

type modelProviderInput struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	APIBase string `json:"apiBase"`
	APIKey  string `json:"apiKey"`
}

type modelProviderView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	APIBase   string `json:"apiBase"`
	HasAPIKey bool   `json:"hasApiKey"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type modelInput struct {
	ProviderID    string                 `json:"providerId"`
	Name          string                 `json:"name"`
	UpstreamModel string                 `json:"upstreamModel"`
	IsDefault     bool                   `json:"isDefault"`
	Capabilities  domainllm.Capabilities `json:"capabilities"`
}

type modelView struct {
	ID            string                 `json:"id"`
	ProviderID    string                 `json:"providerId"`
	Name          string                 `json:"name"`
	UpstreamModel string                 `json:"upstreamModel"`
	IsDefault     bool                   `json:"isDefault"`
	Capabilities  domainllm.Capabilities `json:"capabilities"`
	CreatedAt     string                 `json:"createdAt"`
	UpdatedAt     string                 `json:"updatedAt"`
}

func (s *Server) modelProviders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		providers, err := s.models.ListProviders(r.Context(), devOrganizationID)
		if err != nil {
			fail(w, http.StatusInternalServerError, "model providers could not be listed")
			return
		}
		views := make([]modelProviderView, 0, len(providers))
		for _, provider := range providers {
			views = append(views, modelProviderToView(provider))
		}
		respond(w, http.StatusOK, views)
	case http.MethodPost:
		var input modelProviderInput
		if err := decode(r, &input); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		provider, err := s.models.CreateProvider(
			r.Context(),
			devOrganizationID,
			providerServiceInput(input),
		)
		if err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model_provider.created", "model_provider", provider.ID, nil)
		respond(w, http.StatusCreated, modelProviderToView(provider))
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) modelProvider(w http.ResponseWriter, r *http.Request) {
	providerID := routeParam(r, "id")
	switch r.Method {
	case http.MethodPatch:
		var input modelProviderInput
		if err := decode(r, &input); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		provider, err := s.models.UpdateProvider(
			r.Context(),
			devOrganizationID,
			providerID,
			providerServiceInput(input),
		)
		if err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model_provider.updated", "model_provider", provider.ID, nil)
		respond(w, http.StatusOK, modelProviderToView(provider))
	case http.MethodDelete:
		if err := s.models.DeleteProvider(
			r.Context(),
			devOrganizationID,
			providerID,
		); err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model_provider.deleted", "model_provider", providerID, nil)
		w.WriteHeader(http.StatusNoContent)
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) modelConfigurations(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		models, err := s.models.ListModels(r.Context(), devOrganizationID)
		if err != nil {
			fail(w, http.StatusInternalServerError, "models could not be listed")
			return
		}
		views := make([]modelView, 0, len(models))
		for _, model := range models {
			views = append(views, modelToView(model))
		}
		respond(w, http.StatusOK, views)
	case http.MethodPost:
		var input modelInput
		if err := decode(r, &input); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		model, err := s.models.CreateModel(
			r.Context(),
			devOrganizationID,
			modelServiceInput(input),
		)
		if err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model.created", "model", model.ID, nil)
		respond(w, http.StatusCreated, modelToView(model))
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) modelConfiguration(w http.ResponseWriter, r *http.Request) {
	modelID := routeParam(r, "id")
	switch r.Method {
	case http.MethodPatch:
		var input modelInput
		if err := decode(r, &input); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		model, err := s.models.UpdateModel(
			r.Context(),
			devOrganizationID,
			modelID,
			modelServiceInput(input),
		)
		if err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model.updated", "model", model.ID, nil)
		respond(w, http.StatusOK, modelToView(model))
	case http.MethodDelete:
		if err := s.models.DeleteModel(r.Context(), devOrganizationID, modelID); err != nil {
			handleModelError(w, err)
			return
		}
		s.audit(r.Context(), "model.deleted", "model", modelID, nil)
		w.WriteHeader(http.StatusNoContent)
	default:
		fail(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) agentHostModel(w http.ResponseWriter, r *http.Request) {
	workspaceID := routeParam(r, "workspaceID")
	if err := s.authenticateAgentHost(r, workspaceID); err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	selection, err := s.models.ResolveWorkspace(
		r.Context(),
		devOrganizationID,
		workspaceID,
	)
	if err != nil {
		handleModelError(w, err)
		return
	}
	models, err := s.models.ListModels(r.Context(), devOrganizationID)
	if err != nil {
		handleModelError(w, err)
		return
	}
	providers, err := s.models.ListProviders(r.Context(), devOrganizationID)
	if err != nil {
		handleModelError(w, err)
		return
	}
	providersByID := make(map[string]domainllm.Provider, len(providers))
	for _, provider := range providers {
		providersByID[provider.ID] = provider
	}
	catalog := make([]map[string]any, 0, len(models))
	for _, model := range models {
		provider, ok := providersByID[model.ProviderID]
		if !ok {
			continue
		}
		catalog = append(catalog, map[string]any{
			"id":           domainllm.ModelIdentifier(provider, model),
			"name":         model.Name,
			"vendor":       string(provider.Kind),
			"capabilities": model.Capabilities,
		})
	}
	modelID := domainllm.ModelIdentifier(selection.Provider, selection.Model)
	respond(w, http.StatusOK, map[string]any{
		"id":           modelID,
		"model":        modelID,
		"models":       catalog,
		"provider":     string(selection.Provider.Kind),
		"capabilities": selection.Model.Capabilities,
	})
}

func (s *Server) llmModels(w http.ResponseWriter, r *http.Request) {
	credential, err := s.authenticateAgentHostRequest(r)
	if err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	selection, err := s.models.ResolveWorkspace(
		r.Context(),
		devOrganizationID,
		credential.WorkspaceID,
	)
	if err != nil {
		handleModelError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"items": []map[string]any{{
			"id":           domainllm.ModelIdentifier(selection.Provider, selection.Model),
			"name":         selection.Model.Name,
			"capabilities": selection.Model.Capabilities,
		}},
	})
}

func (s *Server) generateModel(w http.ResponseWriter, r *http.Request) {
	credential, err := s.authenticateAgentHostRequest(r)
	if err != nil {
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	var request domainllm.GenerateRequest
	if err := decodeLimit(r, &request, 64<<20); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	generation, err := s.models.Generate(
		r.Context(),
		devOrganizationID,
		credential.WorkspaceID,
		request,
	)
	if err != nil {
		s.logger.Warn(
			"model request failed",
			"workspace", credential.WorkspaceID,
			"error", err,
		)
		handleModelError(w, err)
		return
	}
	writeGeneration(w, request.Stream, generation)
}

func writeGeneration(
	w http.ResponseWriter,
	stream bool,
	generation domainllm.Generation,
) {
	if stream {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for event := range generation.Events {
			payload, _ := json.Marshal(event)
			_, _ = w.Write([]byte("event: " + event.Type + "\n"))
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(payload)
			_, _ = w.Write([]byte("\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
		return
	}
	for event := range generation.Events {
		if event.Error != nil {
			fail(w, http.StatusBadGateway, event.Error.Message)
			return
		}
		if event.Type == "response.completed" && event.Response != nil {
			respond(w, http.StatusOK, event.Response)
			return
		}
	}
	fail(w, http.StatusBadGateway, "model provider ended without a response")
}

func providerServiceInput(input modelProviderInput) llmservice.ProviderInput {
	return llmservice.ProviderInput{
		ID: input.ID, Name: input.Name, Kind: domainllm.ProviderKind(input.Kind),
		APIBase: input.APIBase, APIKey: input.APIKey,
	}
}

func modelServiceInput(input modelInput) llmservice.ModelInput {
	return llmservice.ModelInput{
		ProviderID: input.ProviderID, Name: input.Name,
		UpstreamModel: input.UpstreamModel, IsDefault: input.IsDefault,
		Capabilities: input.Capabilities,
	}
}

func modelProviderToView(provider domainllm.Provider) modelProviderView {
	return modelProviderView{
		ID: provider.ID, Name: provider.Name, Kind: string(provider.Kind),
		APIBase: provider.APIBase, HasAPIKey: true,
		CreatedAt: provider.CreatedAt, UpdatedAt: provider.UpdatedAt,
	}
}

func modelToView(model domainllm.Model) modelView {
	return modelView{
		ID: model.ID, ProviderID: model.ProviderID, Name: model.Name,
		UpstreamModel: model.UpstreamModel, IsDefault: model.IsDefault,
		Capabilities: model.Capabilities,
		CreatedAt:    model.CreatedAt, UpdatedAt: model.UpdatedAt,
	}
}

func handleModelError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domainllm.ErrInvalid):
		fail(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, domainllm.ErrNotFound):
		fail(w, http.StatusNotFound, "model configuration not found")
	case errors.Is(err, domainllm.ErrNoDefault):
		fail(w, http.StatusServiceUnavailable, "no model is configured for this workspace")
	case errors.Is(err, domainllm.ErrConflict),
		errors.Is(err, domainllm.ErrProviderInUse),
		errors.Is(err, domainllm.ErrModelInUse):
		fail(w, http.StatusConflict, err.Error())
	default:
		fail(w, http.StatusBadGateway, "model service is unavailable")
	}
}
