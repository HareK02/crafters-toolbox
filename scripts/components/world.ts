import {
  ComponentIDString,
  ComponentIDType,
  IComponent,
} from "../component.ts";
import { IReference } from "../reference.ts";

export class World implements IComponent {
  kind = ComponentIDType.WORLD;
  name = "world";
  reference?: IReference;
  source?: IComponent["source"];
  build?: IComponent["build"];
  artifact?: IComponent["artifact"];

  constructor(
    reference?: IReference,
    options?: {
      source?: IComponent["source"];
      build?: IComponent["build"];
      artifact?: IComponent["artifact"];
    },
  ) {
    this.reference = reference;
    this.source = options?.source;
    this.build = options?.build;
    this.artifact = options?.artifact;
  }

  toIDString(): ComponentIDString {
    return `world`;
  }
}
