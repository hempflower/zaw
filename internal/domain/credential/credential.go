package credential

import "fmt"

type Kind string

const (
	UsernamePassword Kind = "username_password"
	Token            Kind = "token"
	SSHKey           Kind = "ssh_key"
)

type Metadata map[string]string

func (m Metadata) Validate(kind Kind) error {
	switch kind {
	case Token:
		return nil
	case UsernamePassword:
		if m["username"] == "" {
			return fmt.Errorf("username is required")
		}
	case SSHKey:
		if m["username"] == "" || m["publicKey"] == "" || m["fingerprint"] == "" {
			return fmt.Errorf("ssh key metadata is incomplete")
		}
	default:
		return fmt.Errorf("unsupported credential kind %q", kind)
	}
	return nil
}
