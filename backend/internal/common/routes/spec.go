package routes

type Spec struct {
	Method string
	Path   string
	Auth   string
	DocRef string
}

func (s Spec) GinPath() string {
	out := []rune(s.Path)
	for i := 0; i < len(out); i++ {
		if out[i] == '{' {
			out[i] = ':'
		}
		if out[i] == '}' {
			out = append(out[:i], out[i+1:]...)
			i--
		}
	}
	return string(out)
}
