workspace "opencode-tdd" "TDD enforcement plugin for OpenCode AI agents" {

    !identifiers hierarchical

    model {
        agent = person "AI Agent" "LLM-powered coding agent using OpenCode"

        opencode = softwareSystem "OpenCode" "AI coding assistant platform" {
            server = container "OpenCode Server" "Hosts plugins and manages sessions" "Node.js"
        }

        tddPlugin = softwareSystem "opencode-tdd Plugin" "Enforces outside-in TDD discipline" {
            hook = container "Edit Hook" "Intercepts edit/write tool calls" "TypeScript"
            verifier = container "LLM Verifier" "Classifies edits and enforces TDD rules" "TypeScript"
            config = container "Config Loader" "Loads .opencode/tdd.json" "TypeScript"
            auditor = container "Auditor" "Records verification decisions (success & parse failures)" "JSONL"
        }

        testRunner = softwareSystem "Test Runner" "External test framework (vitest, jest, etc.)" "External"

        # Relationships
        agent -> opencode.server "Sends prompts"
        opencode.server -> tddPlugin.hook "Triggers before edit/write"
        tddPlugin.hook -> tddPlugin.config "Loads patterns and settings"
        tddPlugin.hook -> tddPlugin.verifier "Delegates classification"
        tddPlugin.verifier -> opencode.server "Creates child session for LLM call"
        tddPlugin.verifier -> tddPlugin.auditor "Records decision & parse errors"
        tddPlugin.hook -> testRunner "Reads test output file"
    }

    views {
        systemContext tddPlugin "Context" {
            include *
            autoLayout
        }

        container tddPlugin "Containers" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                shape Person
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
        }
    }

}
