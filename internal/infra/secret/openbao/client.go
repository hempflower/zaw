package openbao

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/zaw-dev/zaw/internal/domain"
)

type Client struct {
	address    string
	token      string
	httpClient *http.Client
}

func NewClient() domain.SecretStore {
	address := strings.TrimRight(os.Getenv("ZAW_SECRET_MANAGER_ADDR"), "/")
	if address == "" {
		address = "http://127.0.0.1:8200"
	}
	token := os.Getenv("ZAW_SECRET_MANAGER_TOKEN")
	if token == "" {
		token = "zaw-local-only"
	}
	return Client{
		address:    address,
		token:      token,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c Client) Put(
	ctx context.Context,
	ref string,
	values map[string]string,
) error {
	response, err := c.request(
		ctx,
		http.MethodPost,
		"/v1/secret/data/"+ref,
		map[string]any{"data": values},
		"",
	)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return responseError(response)
}

func (c Client) Read(ctx context.Context, ref string) (map[string]string, error) {
	response, err := c.request(
		ctx,
		http.MethodGet,
		"/v1/secret/data/"+ref,
		nil,
		"",
	)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if err := responseError(response); err != nil {
		return nil, err
	}
	var payload struct {
		Data struct {
			Data map[string]string `json:"data"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode secret: %w", err)
	}
	return payload.Data.Data, nil
}

func (c Client) Delete(ctx context.Context, ref string) error {
	response, err := c.request(
		ctx,
		http.MethodDelete,
		"/v1/secret/metadata/"+ref,
		nil,
		"",
	)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	return responseError(response)
}

func (c Client) Lease(
	ctx context.Context,
	ref string,
	buildID string,
	ttl time.Duration,
) (string, error) {
	response, err := c.request(
		ctx,
		http.MethodGet,
		"/v1/secret/data/"+ref,
		nil,
		ttl.String(),
	)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if err := responseError(response); err != nil {
		return "", err
	}
	var payload struct {
		WrapInfo struct {
			Token string `json:"token"`
		} `json:"wrap_info"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode wrapped credential lease: %w", err)
	}
	if payload.WrapInfo.Token == "" {
		return "", fmt.Errorf("secret manager did not create a credential lease")
	}
	return payload.WrapInfo.Token, nil
}

func (c Client) request(
	ctx context.Context,
	method string,
	path string,
	body any,
	wrapTTL string,
) (*http.Response, error) {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		method,
		c.address+path,
		reader,
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Vault-Token", c.token)
	request.Header.Set("Content-Type", "application/json")
	if wrapTTL != "" {
		request.Header.Set("X-Vault-Wrap-TTL", wrapTTL)
	}
	return c.httpClient.Do(request)
}

func responseError(response *http.Response) error {
	if response.StatusCode/100 == 2 {
		return nil
	}
	return fmt.Errorf("secret manager returned %s", response.Status)
}
