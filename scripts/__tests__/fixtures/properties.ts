/**
 * テスト用のcrtb.properties.ymlフィクスチャ
 */

export const MINIMAL_PROPERTIES = `
server:
  type: paper
  version: "1.21.1"
  build: latest
`;

export const PROPERTIES_WITH_COMPONENTS = `
server:
  type: paper
  version: "1.21.1"
  build: latest
components:
  my-plugin:
    type: plugin
    source:
      type: local
      path: ./components/my-plugin
  my-datapack:
    type: datapack
    source:
      type: git
      url: https://github.com/example/datapack.git
`;

export const PROPERTIES_WITH_WORLD = `
server:
  type: paper
  version: "1.21.1"
  build: latest
components:
  world:
    type: world
    source:
      type: local
      path: ./my-world
`;

export const PROPERTIES_WITH_BUILD = `
server:
  type: paper
  version: "1.21.1"
  build: latest
components:
  gradle-plugin:
    type: plugin
    source:
      type: local
      path: ./components/gradle-plugin
    build:
      type: gradle
      task: shadowJar
      output: build/libs
    artifact:
      type: jar
      pattern: '.*-all\\.jar$'
`;

export const LEGACY_PROPERTIES = `
server:
  type: paper
  version: "1.20.4"
  build: latest
components:
  old-plugin:
    type: plugin
    reference:
      path: ./components/old-plugin
`;
