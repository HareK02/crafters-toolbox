import {
  ComponentIDString,
  ComponentIDType,
  IComponent,
} from "../component.ts";
import { IReference } from "../reference.ts";

export class World implements IComponent {
  kind = ComponentIDType.WORLD;
  name = "world";
  path?: string;
  reference?: IReference;
  source?: IComponent["source"];
  build?: IComponent["build"];
  artifact?: IComponent["artifact"];

  constructor(
    reference?: IReference,
    options?: {
      path?: string;
      source?: IComponent["source"];
      build?: IComponent["build"];
      artifact?: IComponent["artifact"];
    },
  ) {
    this.path = options?.path;
    this.reference = reference;
    this.source = options?.source;
    this.build = options?.build;
    this.artifact = options?.artifact;
  }

  toIDString(): ComponentIDString {
    return `world`;
  }
}
