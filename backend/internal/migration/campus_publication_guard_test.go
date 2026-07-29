package migration

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAutoMigrateDoesNotPublishReviewedCampusDirectory(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "migration.go", nil, 0)
	require.NoError(t, err)

	called := map[string]bool{}
	foundAutoMigrate := false
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != "AutoMigrate" {
			continue
		}
		foundAutoMigrate = true
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			identifier, ok := call.Fun.(*ast.Ident)
			if ok {
				called[identifier.Name] = true
			}
			return true
		})
	}

	require.True(t, foundAutoMigrate)
	assert.False(t, called["ensureBeijingOwnerVerifiedDiningSeed"])
	assert.False(t, called["ensureVerifiedDiningDirectoryPublication"])
	assert.False(t, called["PublishBeijingOwnerVerifiedDiningDirectory"])
	assert.False(t, called["PublishVerifiedDiningDirectory"])
}
