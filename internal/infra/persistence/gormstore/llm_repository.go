package gormstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	domainllm "github.com/zaw-dev/zaw/internal/domain/llm"
	"gorm.io/gorm"
)

type LLMRepository struct {
	db *gorm.DB
}

func NewLLMRepository(db *gorm.DB) domainllm.Repository {
	return &LLMRepository{db: db}
}

func (r *LLMRepository) ListProviders(
	ctx context.Context,
	organizationID string,
) ([]domainllm.Provider, error) {
	var rows []LLMProvider
	if err := r.db.WithContext(ctx).
		Where("organization_id = ?", organizationID).
		Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	providers := make([]domainllm.Provider, 0, len(rows))
	for _, row := range rows {
		providers = append(providers, providerFromRow(row))
	}
	return providers, nil
}

func (r *LLMRepository) GetProvider(
	ctx context.Context,
	organizationID string,
	providerID string,
) (domainllm.Provider, error) {
	var row LLMProvider
	err := r.db.WithContext(ctx).
		Where("id = ? AND organization_id = ?", providerID, organizationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainllm.Provider{}, domainllm.ErrNotFound
	}
	return providerFromRow(row), err
}

func (r *LLMRepository) CreateProvider(
	ctx context.Context,
	provider domainllm.Provider,
) error {
	err := r.db.WithContext(ctx).Create(providerToRow(provider)).Error
	return normalizeLLMWriteError(err)
}

func (r *LLMRepository) UpdateProvider(
	ctx context.Context,
	provider domainllm.Provider,
) error {
	result := r.db.WithContext(ctx).Model(&LLMProvider{}).
		Where("id = ? AND organization_id = ?", provider.ID, provider.OrganizationID).
		Updates(map[string]any{
			"name":       provider.Name,
			"kind":       provider.Kind,
			"api_base":   provider.APIBase,
			"updated_at": time.Now().UTC(),
		})
	if result.Error != nil {
		return normalizeLLMWriteError(result.Error)
	}
	if result.RowsAffected == 0 {
		return domainllm.ErrNotFound
	}
	return nil
}

func (r *LLMRepository) DeleteProvider(
	ctx context.Context,
	organizationID string,
	providerID string,
) error {
	var count int64
	if err := r.db.WithContext(ctx).Model(&LLMModel{}).
		Where("provider_id = ?", providerID).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return domainllm.ErrProviderInUse
	}
	result := r.db.WithContext(ctx).
		Where("id = ? AND organization_id = ?", providerID, organizationID).
		Delete(&LLMProvider{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domainllm.ErrNotFound
	}
	return nil
}

func (r *LLMRepository) ListModels(
	ctx context.Context,
	organizationID string,
) ([]domainllm.Model, error) {
	var rows []LLMModel
	err := r.db.WithContext(ctx).Table("llm_models").
		Select("llm_models.*").
		Joins("JOIN llm_providers ON llm_providers.id = llm_models.provider_id").
		Where("llm_providers.organization_id = ?", organizationID).
		Order("llm_models.updated_at DESC").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	models := make([]domainllm.Model, 0, len(rows))
	for _, row := range rows {
		models = append(models, modelFromRow(row))
	}
	return models, nil
}

func (r *LLMRepository) GetModel(
	ctx context.Context,
	organizationID string,
	modelID string,
) (domainllm.Model, error) {
	var row LLMModel
	err := r.db.WithContext(ctx).Table("llm_models").
		Select("llm_models.*").
		Joins("JOIN llm_providers ON llm_providers.id = llm_models.provider_id").
		Where("llm_models.id = ? AND llm_providers.organization_id = ?", modelID, organizationID).
		Scan(&row).Error
	if err != nil {
		return domainllm.Model{}, err
	}
	if row.ID == "" {
		return domainllm.Model{}, domainllm.ErrNotFound
	}
	return modelFromRow(row), nil
}

func (r *LLMRepository) CreateModel(
	ctx context.Context,
	organizationID string,
	model domainllm.Model,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var provider LLMProvider
		if err := tx.Where(
			"id = ? AND organization_id = ?",
			model.ProviderID,
			organizationID,
		).First(&provider).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return domainllm.ErrNotFound
		} else if err != nil {
			return err
		}
		if model.IsDefault {
			if err := clearDefaultModel(tx, organizationID, ""); err != nil {
				return err
			}
		}
		return normalizeLLMWriteError(tx.Create(modelToRow(model)).Error)
	})
}

func (r *LLMRepository) UpdateModel(
	ctx context.Context,
	organizationID string,
	model domainllm.Model,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing LLMModel
		err := tx.Table("llm_models").Select("llm_models.*").
			Joins("JOIN llm_providers ON llm_providers.id = llm_models.provider_id").
			Where(
				"llm_models.id = ? AND llm_providers.organization_id = ?",
				model.ID,
				organizationID,
			).Scan(&existing).Error
		if err != nil {
			return err
		}
		if existing.ID == "" {
			return domainllm.ErrNotFound
		}
		if model.IsDefault {
			if err := clearDefaultModel(tx, organizationID, model.ID); err != nil {
				return err
			}
		}
		return normalizeLLMWriteError(tx.Model(&LLMModel{}).
			Where("id = ?", model.ID).
			Updates(map[string]any{
				"name":           model.Name,
				"upstream_model": model.UpstreamModel,
				"is_default":     model.IsDefault,
				"capabilities":   capabilitiesJSON(model.Capabilities),
				"updated_at":     time.Now().UTC(),
			}).Error)
	})
}

func (r *LLMRepository) DeleteModel(
	ctx context.Context,
	organizationID string,
	modelID string,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Workspace{}).Where("model_id = ?", modelID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return domainllm.ErrModelInUse
		}
		model, err := (&LLMRepository{db: tx}).GetModel(ctx, organizationID, modelID)
		if err != nil {
			return err
		}
		if model.IsDefault {
			return domainllm.ErrConflict
		}
		return tx.Where("id = ?", modelID).Delete(&LLMModel{}).Error
	})
}

func (r *LLMRepository) ResolveWorkspace(
	ctx context.Context,
	organizationID string,
	workspaceID string,
) (domainllm.Selection, error) {
	var workspace Workspace
	err := r.db.WithContext(ctx).
		Where("id = ? AND organization_id = ?", workspaceID, organizationID).
		First(&workspace).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainllm.Selection{}, domainllm.ErrNotFound
	}
	if err != nil {
		return domainllm.Selection{}, err
	}
	query := r.db.WithContext(ctx).Table("llm_models").
		Select("llm_models.*").
		Joins("JOIN llm_providers ON llm_providers.id = llm_models.provider_id").
		Where("llm_providers.organization_id = ?", organizationID)
	if workspace.ModelID != "" {
		query = query.Where("llm_models.id = ?", workspace.ModelID)
	} else {
		query = query.Where("llm_models.is_default = ?", true)
	}
	var modelRow LLMModel
	if err := query.First(&modelRow).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return domainllm.Selection{}, domainllm.ErrNoDefault
	} else if err != nil {
		return domainllm.Selection{}, err
	}
	var providerRow LLMProvider
	if err := r.db.WithContext(ctx).
		Where("id = ? AND organization_id = ?", modelRow.ProviderID, organizationID).
		First(&providerRow).Error; err != nil {
		return domainllm.Selection{}, err
	}
	return domainllm.Selection{
		Provider: providerFromRow(providerRow),
		Model:    modelFromRow(modelRow),
	}, nil
}

func clearDefaultModel(db *gorm.DB, organizationID string, exceptID string) error {
	query := db.Model(&LLMModel{}).
		Where("provider_id IN (?)", db.Model(&LLMProvider{}).
			Select("id").Where("organization_id = ?", organizationID))
	if exceptID != "" {
		query = query.Where("id <> ?", exceptID)
	}
	return query.Update("is_default", false).Error
}

func providerToRow(provider domainllm.Provider) *LLMProvider {
	return &LLMProvider{
		ID: provider.ID, OrganizationID: provider.OrganizationID,
		Name: provider.Name, Kind: string(provider.Kind), APIBase: provider.APIBase,
		SecretRef: provider.SecretRef,
	}
}

func providerFromRow(row LLMProvider) domainllm.Provider {
	return domainllm.Provider{
		ID: row.ID, OrganizationID: row.OrganizationID, Name: row.Name,
		Kind: domainllm.ProviderKind(row.Kind), APIBase: row.APIBase, SecretRef: row.SecretRef,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func modelToRow(model domainllm.Model) *LLMModel {
	return &LLMModel{
		ID: model.ID, ProviderID: model.ProviderID, Name: model.Name,
		UpstreamModel: model.UpstreamModel, IsDefault: model.IsDefault,
		Capabilities: capabilitiesJSON(model.Capabilities),
	}
}

func modelFromRow(row LLMModel) domainllm.Model {
	var capabilities domainllm.Capabilities
	_ = json.Unmarshal(row.Capabilities, &capabilities)
	return domainllm.Model{
		ID: row.ID, ProviderID: row.ProviderID, Name: row.Name,
		UpstreamModel: row.UpstreamModel, IsDefault: row.IsDefault,
		Capabilities: capabilities,
		CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339Nano),
		UpdatedAt:    row.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func capabilitiesJSON(capabilities domainllm.Capabilities) []byte {
	payload, _ := json.Marshal(capabilities)
	return payload
}

func normalizeLLMWriteError(err error) error {
	if err == nil {
		return nil
	}
	return errors.Join(domainllm.ErrConflict, err)
}
