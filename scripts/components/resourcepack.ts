import {
  ComponentIDString,
  ComponentIDType,
  IComponent,
} from "../component.ts";
import { IReference } from "../reference.ts";

export class Resourcepack implements IComponent {
  kind = ComponentIDType.RESOURCEPACKS;
  name: string;
  path?: string;
  reference?: IReference;
  source?: IComponent["source"];
  build?: IComponent["build"];
  artifact?: IComponent["artifact"];

  constructor(
    name: string,
    reference?: IReference,
    options?: {
      path?: string;
      source?: IComponent["source"];
      build?: IComponent["build"];
      artifact?: IComponent["artifact"];
    },
  ) {
    this.name = name;
    this.path = options?.path;
    this.reference = reference;
    this.source = options?.source;
    this.build = options?.build;
    this.artifact = options?.artifact;
  }

  toIDString(): ComponentIDString {
    return `rp:${this.name}`;
  }
}
