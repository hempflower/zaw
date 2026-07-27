package gormstore

import (
	"reflect"
	"testing"
)

func TestPersistentModelsDoNotEnableSoftDelete(t *testing.T) {
	models := []any{
		Organization{}, User{}, Membership{}, Credential{}, Template{},
		TemplateSource{}, TemplateParameter{}, Workspace{}, WorkspaceBuild{},
		WorkspaceResource{}, Provisioner{}, ProvisionerJob{}, AgentHost{}, AuditLog{},
	}
	for _, model := range models {
		modelType := reflect.TypeOf(model)
		if _, found := modelType.FieldByName("DeletedAt"); found {
			t.Fatalf("%s enables GORM soft deletion", modelType.Name())
		}
	}
}
