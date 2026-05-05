package routes

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func LoadFromRouteMap(path string) ([]Spec, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var specs []Spec
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "| `") {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 7 {
			continue
		}
		method := strings.Trim(parts[1], " `")
		pathPart := strings.Trim(parts[2], " `")
		auth := strings.Trim(parts[4], " `")
		docRef := strings.TrimSpace(parts[6])
		if method == "" || pathPart == "" {
			continue
		}
		specs = append(specs, Spec{
			Method: method,
			Path:   pathPart,
			Auth:   auth,
			DocRef: docRef,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(specs) == 0 {
		return nil, fmt.Errorf("no route specs found in %s", path)
	}
	return specs, nil
}
