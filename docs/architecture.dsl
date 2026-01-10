workspace "opencode-tdd SDK E2E" "SDK-driven e2e tests for TDD plugin" {

    !identifiers hierarchical

    model {
        author = person "Plugin Author" "Maintains opencode-tdd plugin"

        system = softwareSystem "opencode-tdd e2e suite" "Runs SDK-based e2e tests" {
            runner = container "E2E Test Runner" "Bun tests using opencode SDK" "Bun + TypeScript"
            server = container "OpenCode Server" "Server started by SDK" "opencode"
            fixture = container "Fixture Workspace" "Project config + plugin + files" "Filesystem"
        }

        author -> system.runner "Runs"
        system.runner -> system.server "Starts and sends prompts"
        system.server -> system.fixture "Loads config and plugin"
    }

    views {
        systemContext system "Context" {
            include *
            autoLayout
        }

        container system "Containers" {
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
        }
    }

}
