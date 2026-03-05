import type { ArtistRecord, CategoryRecord, ServiceRecord } from "../domain/entities.js";

export interface PublicDiscoveryRepository {
  listCategories(): Promise<CategoryRecord[]>;
  listArtists(): Promise<ArtistRecord[]>;
  listServicesByArtistId(artistId: string): Promise<ServiceRecord[]>;
}

export class NoopPublicDiscoveryRepository implements PublicDiscoveryRepository {
  async listCategories(): Promise<CategoryRecord[]> {
    return [];
  }

  async listArtists(): Promise<ArtistRecord[]> {
    return [];
  }

  async listServicesByArtistId(_artistId: string): Promise<ServiceRecord[]> {
    return [];
  }
}
