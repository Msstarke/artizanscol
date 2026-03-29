export type AppEnv = {
  awsRegion: string;
  stage: "dev" | "prod";
  apiBaseUrl?: string;
  domainArea?: string;

  usersTableName: string;
  artistsTableName: string;
  servicesTableName: string;
  bookingsTableName: string;
  messagesTableName: string;
  notificationsTableName: string;
  reportsTableName: string;
  categoriesTableName: string;
  invoicesTableName: string;
  payoutsTableName: string;
  systemConfigTableName: string;
  roleAssignmentsTableName: string;

  eventsQueueUrl: string;
  stripeSecretArn: string;
  stripeWebhookSecretArn: string;
  appSecretArn?: string;
  uploadsBucketName?: string;

  cognitoIssuer: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
};

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = String(env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const stageRaw = requireEnv("STAGE", env).toLowerCase();
  const stage = stageRaw === "prod" ? "prod" : "dev";
  const apiBaseUrl = String(env.API_BASE_URL || "").trim() || undefined;
  const domainArea = String(env.DOMAIN_AREA || "").trim() || undefined;
  const appSecretArn = String(env.APP_SECRET_ARN || "").trim() || undefined;

  return {
    awsRegion: requireEnv("AWS_REGION", env),
    stage,
    apiBaseUrl,
    domainArea,

    usersTableName: requireEnv("USERS_TABLE_NAME", env),
    artistsTableName: requireEnv("ARTISTS_TABLE_NAME", env),
    servicesTableName: requireEnv("SERVICES_TABLE_NAME", env),
    bookingsTableName: requireEnv("BOOKINGS_TABLE_NAME", env),
    messagesTableName: requireEnv("MESSAGES_TABLE_NAME", env),
    notificationsTableName: requireEnv("NOTIFICATIONS_TABLE_NAME", env),
    reportsTableName: requireEnv("REPORTS_TABLE_NAME", env),
    categoriesTableName: requireEnv("CATEGORIES_TABLE_NAME", env),
    invoicesTableName: requireEnv("INVOICES_TABLE_NAME", env),
    payoutsTableName: requireEnv("PAYOUTS_TABLE_NAME", env),
    systemConfigTableName: requireEnv("SYSTEM_CONFIG_TABLE_NAME", env),
    roleAssignmentsTableName: requireEnv("ROLE_ASSIGNMENTS_TABLE_NAME", env),

    eventsQueueUrl: requireEnv("EVENTS_QUEUE_URL", env),
    stripeSecretArn: requireEnv("STRIPE_SECRET_ARN", env),
    stripeWebhookSecretArn: requireEnv("STRIPE_WEBHOOK_SECRET_ARN", env),
    appSecretArn,
    uploadsBucketName: String(env.UPLOADS_BUCKET_NAME || "").trim() || undefined,

    cognitoIssuer: requireEnv("COGNITO_ISSUER", env),
    cognitoUserPoolId: requireEnv("COGNITO_USER_POOL_ID", env),
    cognitoClientId: requireEnv("COGNITO_CLIENT_ID", env),
  };
}
