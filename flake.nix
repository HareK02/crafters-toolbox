{
  description = "Minecraft dev environment with JDK 21 and Gradle";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            jdk21
            gradle
            kotlin
            unzip
          ];

          # 必要に応じて環境変数を設定
          shellHook = ''
            export JAVA_HOME=${pkgs.jdk21}/lib/openjdk
            export PATH="$JAVA_HOME/bin:$PATH"
            export GRADLE_USER_HOME="$PWD/.gradle"
          '';
        };
      }
    );
}
