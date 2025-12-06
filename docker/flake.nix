{
  description = "Nix-built Docker images for Crafter's Toolbox";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachSystem [ "x86_64-linux" ] (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        imageName = "crafters-toolbox";
        imageTag = "latest";

        basePackages = with pkgs; [
          bashInteractive
          coreutils
          glibc
          glibc.bin
          libxcrypt
          git
          openssh
          fish
          gradle
          temurin-bin-21
          deno
          jq
          curl
          tree
          gzip
          unzip
          cacert
          nss_wrapper
          gettext
          shadow
          gawk
          gnugrep
          findutils
          procps
          which
        ];

        packagesLayer = pkgs.buildEnv {
          name = "ctbx-packages";
          paths = basePackages;
          pathsToLink = [ "/bin" "/sbin" "/lib" "/share" "/etc" ];
        };

        assetsLayer = pkgs.runCommand "ctbx-assets" {} ''
          mkdir -p $out/usr/local/bin
          cp ${./entrypoint.sh} $out/usr/local/bin/entrypoint.sh
          chmod +x $out/usr/local/bin/entrypoint.sh
          
          # Create role-specific entrypoints
          ln -s entrypoint.sh $out/usr/local/bin/start-game
          ln -s entrypoint.sh $out/usr/local/bin/start-ssh

          mkdir -p $out/opt/ssh
          cp ${./sshd_config} $out/opt/ssh/sshd_config
        '';

        rootfs = pkgs.buildEnv {
          name = "ctbx-rootfs";
          paths = [ packagesLayer assetsLayer ];
          pathsToLink = [ "/bin" "/sbin" "/lib" "/share" "/etc" "/opt" "/usr" ];
        };

        image = pkgs.dockerTools.buildImage {
          name = imageName;
          tag = imageTag;
          copyToRoot = rootfs;
          extraCommands = ''
            mkdir -p home/container/server
            mkdir -p home/container/components
            mkdir -p home/container/.ssh/host_keys
          '';
          runAsRoot = ''
            #!${pkgs.runtimeShell}
            mkdir -p /home/container /opt/ssh /opt/monitor /usr/bin /usr/sbin /usr/lib /etc /var/spool/mail /root
            if [ ! -s /etc/passwd ]; then
              cat <<'EOF' > /etc/passwd
root:x:0:0:root:/root:/bin/bash
EOF
            fi
            if [ ! -s /etc/group ]; then
              cat <<'EOF' > /etc/group
root:x:0:
mail:x:8:
EOF
            fi
            if [ ! -s /etc/shadow ]; then
              cat <<'EOF' > /etc/shadow
root:*:0:0:99999:7:::
EOF
            fi
            if [ ! -s /etc/gshadow ]; then
              cat <<'EOF' > /etc/gshadow
root:::root
EOF
            fi
            if [ ! -s /etc/login.defs ]; then
              cat <<'EOF' > /etc/login.defs
# Managed by Crafter's Toolbox image
CHFN_RESTRICT        rwh
DEFAULT_HOME         yes
ENCRYPT_METHOD       SHA512
ENV_SUPATH           PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV_PATH             PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games
GID_MIN              1000
GID_MAX              60000
LOGIN_RETRIES        5
LOGIN_TIMEOUT        60
MAIL_DIR             /var/spool/mail
PASS_MAX_DAYS        99999
PASS_MIN_DAYS        0
PASS_WARN_AGE        7
SHA_CRYPT_MIN_ROUNDS 5000
SHA_CRYPT_MAX_ROUNDS 5000
SYS_GID_MIN          101
SYS_GID_MAX          999
SYS_UID_MIN          101
SYS_UID_MAX          999
UID_MIN              1000
UID_MAX              60000
UMASK                077
USERGROUPS_ENAB      yes
EOF
            fi
            touch /etc/subuid /etc/subgid
            mkdir -p /var/empty/sshd /tmp
            chmod 1777 /tmp
            if ! grep -q '^sshd:' /etc/passwd; then
              useradd -r -M -d /var/empty/sshd -s /bin/false sshd
            fi
            ln -sf /bin/sshd /usr/sbin/sshd
            ln -sf /bin/fish /usr/bin/fish
            ln -sf /bin/env /usr/bin/env
            ln -sf ${pkgs.nss_wrapper}/lib/libnss_wrapper.so /usr/lib/libnss_wrapper.so
            arch="$(${pkgs.coreutils}/bin/uname -m)"
            mkdir -p "/usr/lib/$arch-linux-gnu"
            ln -sf /usr/lib/libnss_wrapper.so "/usr/lib/$arch-linux-gnu/libnss_wrapper.so"
          '';
          config = {
            Cmd = [ "/usr/local/bin/entrypoint.sh" ];
            WorkingDir = "/home/container/server";
            Env =
              let
                javaHome = "${pkgs.temurin-bin-21}/lib/openjdk";
              in
              [
                "LC_ALL=C.UTF-8"
                "LANG=C.UTF-8"
                "HOME=/home/container"
                "JAVA_HOME=${javaHome}"
                "PATH=/usr/local/bin:/usr/bin:/bin:${javaHome}/bin"
                "LOGIN_SHELL=/usr/bin/fish"
                "DEFAULT_SHELL=/usr/bin/fish"
                "DENO_DIR=/home/container/.deno"
              ];
            ExposedPorts = {
              "25565/tcp" = {};
              "2222/tcp" = {};
            };
          };
        };
      in
      {
        packages = {
          dockerImage = image;
          default = image;
        };
      }
    );
}
