{
  description = "LOON: LOON Offers Only Nuanced-gentle — Claude Code visual identity for pi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (system: {
        default = nixpkgs.legacyPackages.${system}.callPackage ./default.nix { };
      });

      # `nix develop` gives a shell with the pi packages this extension builds
      # against, so `node --experimental-strip-types --test extension/*.test.ts`
      # runs without a rebuild.
      devShells = forAllSystems (system: {
        default = nixpkgs.legacyPackages.${system}.mkShell {
          packages = [
            nixpkgs.legacyPackages.${system}.nodejs
            nixpkgs.legacyPackages.${system}.nodePackages.typescript
          ];
        };
      });
    };
}