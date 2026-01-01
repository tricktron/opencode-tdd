{
    description               = "opencode-tdd";
    inputs.nixpkgs.url        = "github:NixOS/nixpkgs/nixos-unstable";
    inputs.nix-github-actions =
    {
        url                    = "github:nix-community/nix-github-actions";
        inputs.nixpkgs.follows = "nixpkgs";
    };

    outputs = { self, nixpkgs, nix-github-actions, ... }:
    let
        supportedSystems =
        [
            "x86_64-darwin"
            "aarch64-darwin"
            "x86_64-linux"
        ];
        forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
        devShells = forAllSystems
        (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
        in
        {
            default = pkgs.mkShell
            {
                packages = with pkgs;
                [
                    nodejs
                    bun
                    eslint
                    typescript
                    prettier
                ];

            # Fix to avoid changing my git language to German
            shellHook = pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
                export DEVELOPER_DIR=/Library/Developer/CommandLineTools
             '';
            };

        });
    };
}
