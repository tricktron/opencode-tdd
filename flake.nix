{
    description = "opencode-tdd";
    inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    inputs.nix-github-actions = {
        url = "github:nix-community/nix-github-actions";
        inputs.nixpkgs.follows = "nixpkgs";
    };

    outputs = { self, nixpkgs, nix-github-actions, ... }:
    let
        supportedSystems = [
            "aarch64-darwin"
            "aarch64-linux"
            "x86_64-linux"
        ];
        forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
        devShells = forAllSystems (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
        in
        {
            default = pkgs.mkShell {
                packages = with pkgs; [
                    nodejs
                    bun
                    eslint
                    typescript
                    prettier
                    opencode
                ];

                # Fix to avoid changing my git language to German
                shellHook = pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
                    export DEVELOPER_DIR=/Library/Developer/CommandLineTools
                '';
            };
        });

        packages = forAllSystems (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
            node_modules = pkgs.stdenvNoCC.mkDerivation {
                pname = "opencode-tdd-node_modules";
                version = "0.1.0";
                src = ./.;

                nativeBuildInputs = with pkgs; [ bun ];

                dontConfigure = true;

                buildPhase = ''
                    runHook preBuild

                    export BUN_INSTALL_CACHE_DIR=$(mktemp -d)

                    bun install \
                        --frozen-lockfile \
                        --no-progress

                    runHook postBuild
                '';

                installPhase = ''
                    runHook preInstall

                    mkdir -p $out
                    cp -r node_modules $out/

                    runHook postInstall
                '';

                dontFixup = true;

                outputHash = "sha256-WQRHLbfw/cUxJdrneSPPlawmgNIkWX3UVxQDO58roV0=";
                outputHashAlgo = "sha256";
                outputHashMode = "recursive";
            };
        in
        {
            default = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
                pname = "opencode-tdd";
                version = "0.1.0";
                src = ./.;
                inherit node_modules;

                nativeBuildInputs = with pkgs; [ bun ];
                buildInputs = with pkgs; [ nodejs ];

                dontConfigure = true;

                buildPhase = ''
                    runHook preBuild

                    cp -r ${finalAttrs.node_modules}/node_modules .
                    patchShebangs node_modules
                    bun run build

                    runHook postBuild
                '';

                installPhase = ''
                    runHook preInstall

                    mkdir -p $out/{bin,lib}
                    cp package.json $out/lib/package.json
                    cp -r node_modules $out/lib/node_modules
                    cp dist/index.js $out/bin/opencode-tdd
                    chmod a+x $out/bin/opencode-tdd

                    runHook postInstall
                '';

                doCheck = true;

                checkPhase = ''
                    runHook preCheck

                    bun lint
                    bun run test

                    runHook postCheck
                '';
            });
        });

        githubActions =
        let
            githubRunnerSystems = supportedSystems;
        in
            nix-github-actions.lib.mkGithubMatrix {
                checks = nixpkgs.lib.getAttrs githubRunnerSystems self.packages;
            };
    };
}
