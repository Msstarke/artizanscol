import type {
  ArtistRecord,
  CategoryRecord,
  ReportRecord,
  ServiceRecord,
  SystemConfigRecord,
  UserRecord,
} from "../domain/entities.js";

export interface AdminWorkspaceRepository {
  listArtists(): Promise<ArtistRecord[]>;
  listAllArtists(): Promise<ArtistRecord[]>;
  getArtistById(artistId: string): Promise<ArtistRecord | null>;
  patchArtist(artist: ArtistRecord): Promise<void>;

  getServiceById(serviceId: string): Promise<ServiceRecord | null>;
  patchService(service: ServiceRecord): Promise<void>;

  listReports(): Promise<ReportRecord[]>;
  getReportById(reportId: string): Promise<ReportRecord | null>;
  patchReport(report: ReportRecord): Promise<void>;

  listUsers(): Promise<UserRecord[]>;
  getUserById(userId: string): Promise<UserRecord | null>;
  patchUser(user: UserRecord): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  deleteArtist(artistId: string): Promise<void>;

  listCategories(): Promise<CategoryRecord[]>;
  getCategoryById(categoryId: string): Promise<CategoryRecord | null>;
  patchCategory(category: CategoryRecord): Promise<void>;

  getSystemConfig(): Promise<SystemConfigRecord | null>;
  putSystemConfig(config: SystemConfigRecord): Promise<void>;
  patchSystemConfig(config: SystemConfigRecord): Promise<void>;
}

export class NoopAdminWorkspaceRepository implements AdminWorkspaceRepository {
  async listArtists(): Promise<ArtistRecord[]> {
    return [];
  }

  async listAllArtists(): Promise<ArtistRecord[]> {
    return [];
  }

  async getArtistById(_artistId: string): Promise<ArtistRecord | null> {
    return null;
  }

  async patchArtist(_artist: ArtistRecord): Promise<void> {}

  async getServiceById(_serviceId: string): Promise<ServiceRecord | null> {
    return null;
  }

  async patchService(_service: ServiceRecord): Promise<void> {}

  async listReports(): Promise<ReportRecord[]> {
    return [];
  }

  async getReportById(_reportId: string): Promise<ReportRecord | null> {
    return null;
  }

  async patchReport(_report: ReportRecord): Promise<void> {}

  async listUsers(): Promise<UserRecord[]> {
    return [];
  }

  async getUserById(_userId: string): Promise<UserRecord | null> {
    return null;
  }

  async patchUser(_user: UserRecord): Promise<void> {}
  async deleteUser(_userId: string): Promise<void> {}
  async deleteArtist(_artistId: string): Promise<void> {}

  async listCategories(): Promise<CategoryRecord[]> {
    return [];
  }

  async getCategoryById(_categoryId: string): Promise<CategoryRecord | null> {
    return null;
  }

  async patchCategory(_category: CategoryRecord): Promise<void> {}

  async getSystemConfig(): Promise<SystemConfigRecord | null> {
    return null;
  }

  async putSystemConfig(_config: SystemConfigRecord): Promise<void> {}

  async patchSystemConfig(_config: SystemConfigRecord): Promise<void> {}
}
