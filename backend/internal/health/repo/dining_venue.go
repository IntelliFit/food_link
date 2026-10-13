package repo

import (
	"food_link/backend/internal/health/domain"
	"strings"
)

func diningVenueLike(name string) string {
	key := domain.DiningVenueKey(name)
	return "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(key) + "%"
}
