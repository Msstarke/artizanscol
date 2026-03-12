export const AWS_CONFIG_KEY = "artizans.aws.v1";
export const AWS_CONFIG_VERSION = 1;

const DEFAULT_AWS_CONFIG = {
  schemaVersion: AWS_CONFIG_VERSION,
  region: "ap-southeast-2",
  accountId: "",
  stackName: "",
  s3BucketName: "",
  cloudFrontDistributionId: "",
  cloudFrontDomain: "",
  ec2ApiBaseUrl: "",
  certificateArn: "",
  privateCaArn: "",
  cognitoUserPoolId: "ap-southeast-2_SW8VfLv3l",
  cognitoUserPoolClientId: "2lhd1i7taqjsk298dfsgigl1m2",
  cognitoIdentityPoolId: "",
};

const MUTABLE_CONSOLE_FIELDS = [
  "accountId",
  "stackName",
  "s3BucketName",
  "cloudFrontDistributionId",
  "cloudFrontDomain",
  "certificateArn",
  "privateCaArn",
];

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function normalize(config) {
  return {
    ...DEFAULT_AWS_CONFIG,
    ...(config || {}),
    schemaVersion: AWS_CONFIG_VERSION,
  };
}

function pickMutableConsoleFields(config) {
  return MUTABLE_CONSOLE_FIELDS.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(config || {}, key)) {
      acc[key] = config[key];
    }
    return acc;
  }, {});
}

export function getAWSConfig() {
  const cached = safeParse(localStorage.getItem(AWS_CONFIG_KEY)) || {};
  if (cached.schemaVersion !== AWS_CONFIG_VERSION) {
    const initialConfig = {
      schemaVersion: AWS_CONFIG_VERSION,
      ...pickMutableConsoleFields(cached),
    };
    localStorage.setItem(AWS_CONFIG_KEY, JSON.stringify(initialConfig));
  }

  return {
    ...DEFAULT_AWS_CONFIG,
    ...pickMutableConsoleFields(cached),
    schemaVersion: AWS_CONFIG_VERSION,
  };
}

export function saveAWSConfig(nextConfig) {
  const normalized = normalize(nextConfig);
  const safePersisted = {
    schemaVersion: AWS_CONFIG_VERSION,
    ...pickMutableConsoleFields(normalized),
  };
  localStorage.setItem(AWS_CONFIG_KEY, JSON.stringify(safePersisted));
  return {
    ...DEFAULT_AWS_CONFIG,
    ...safePersisted,
  };
}

export function resetAWSConfig() {
  localStorage.setItem(
    AWS_CONFIG_KEY,
    JSON.stringify({
      schemaVersion: AWS_CONFIG_VERSION,
    }),
  );
  return { ...DEFAULT_AWS_CONFIG };
}

export function getAWSConsoleLinks(config = getAWSConfig()) {
  const region = encodeURIComponent(config.region || "ap-southeast-2");
  const bucket = encodeURIComponent(config.s3BucketName || "");
  const distributionId = encodeURIComponent(config.cloudFrontDistributionId || "");

  const s3Path = bucket ? `/buckets/${bucket}?region=${region}&tab=objects` : "";
  const distributionPath = distributionId ? `/distributions/${distributionId}` : "";

  return {
    ec2: `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#Instances:`,
    billing: "https://console.aws.amazon.com/billing/home",
    health: "https://phd.aws.amazon.com/phd/home#/",
    acm: `https://${region}.console.aws.amazon.com/acm/home?region=${region}#/certificates`,
    cloudFront: `https://us-east-1.console.aws.amazon.com/cloudfront/v4/home#${distributionPath || "/distributions"}`,
    privateCa: `https://${region}.console.aws.amazon.com/acm-pca/home?region=${region}#/authorities`,
    cognito: `https://${region}.console.aws.amazon.com/cognito/v2/idp/user-pools?region=${region}`,
    cloudShell: `https://${region}.console.aws.amazon.com/cloudshell/home?region=${region}`,
    s3: `https://s3.console.aws.amazon.com/s3${s3Path}`,
    iam: "https://console.aws.amazon.com/iamv2/home#/home",
    support: "https://console.aws.amazon.com/support/home",
  };
}

export function buildCloudShellDeployCommands(config = getAWSConfig()) {
  const bucket = config.s3BucketName || "<your-s3-bucket>";
  const distributionId = config.cloudFrontDistributionId || "<your-cloudfront-distribution-id>";

  return [
    `aws s3 sync . s3://${bucket} --delete --exclude \".git/*\" --exclude \"output/*\" --exclude \"aws/*\"`,
    `aws cloudfront create-invalidation --distribution-id ${distributionId} --paths \"/*\"`,
  ].join("\n");
}
