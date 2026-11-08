package repo

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDishQueryPiecesSplitsIntoTwoCharacterPieces(t *testing.T) {
	require.Equal(t, []string{"水煮", "煮牛", "牛肉"}, DishQueryPieces("水煮牛肉"))
	require.Equal(t, []string{"番茄", "茄炒", "炒蛋"}, DishQueryPieces(" 番茄 炒蛋 "))
	require.Equal(t, []string{"哈哈"}, DishQueryPieces("哈哈哈"), "repeated pieces count once")
	require.Nil(t, DishQueryPieces("牛肉"), "a two-character query is already the whole search")
	require.Nil(t, DishQueryPieces("%_"), "LIKE wildcards are dropped")
}
