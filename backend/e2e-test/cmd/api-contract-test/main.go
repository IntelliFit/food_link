package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	e2e "food_link/backend/e2e-test/runner"
)

func main() {
	var opts e2e.Options
	flag.StringVar(&opts.SuitePath, "suite", "e2e-test/suite.yaml", "api contract suite yaml path")
	flag.StringVar(&opts.ConfigDir, "config-dir", ".", "backend config directory")
	flag.StringVar(&opts.CaseID, "case", "", "run only the case with this id")
	flag.StringVar(&opts.Group, "group", "", "run only cases in this group")
	flag.BoolVar(&opts.List, "list", false, "list selected cases without running them")
	flag.Bool("all", true, "run all selected cases; kept for readable command lines")
	flag.BoolVar(&opts.KeepDB, "keep-db", false, "keep temporary database after run")
	timeout := flag.Duration("timeout", 5*time.Minute, "overall run timeout")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	result, err := e2e.Run(ctx, opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "api contract test failed to start: %v\n", err)
		os.Exit(2)
	}
	if opts.List {
		return
	}
	for _, caseResult := range result.CaseResults {
		status := "PASS"
		if !caseResult.Passed {
			status = "FAIL"
		}
		fmt.Printf("%s\t%s\t[id=%s]\t%s %s\n", status, caseResult.Name, caseResult.ID, caseResult.Method, caseResult.Path)
		if caseResult.Desc != "" {
			fmt.Printf("    %s\n", caseResult.Desc)
		}
	}
	fmt.Printf("\nSuite: %s\n", result.Suite)
	if result.SuiteName != "" {
		fmt.Printf("Name: %s\n", result.SuiteName)
	}
	if result.SuiteDesc != "" {
		fmt.Printf("Desc: %s\n", result.SuiteDesc)
	}
	if result.TempDBName != "" {
		fmt.Printf("Temp DB: %s\n", result.TempDBName)
	}
	fmt.Printf("Total: %d, Passed: %d, Failed: %d\n", result.Total, result.Passed, result.Failed)
	if result.Failed > 0 {
		fmt.Println("\nFailures:")
		for _, failure := range result.Failures {
			fmt.Printf("- %s: %s\n", failure.Case, failure.Message)
		}
		os.Exit(1)
	}
}
