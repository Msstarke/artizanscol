# Backend Rollback Playbook

Use this playbook when a backend deploy introduces regressions in `dev` or `prod`.

## Scope
- CloudFormation infrastructure changes
- Lambda runtime code versions published by CI (`--publish`)

## 1) Roll back CloudFormation safely (change set preview)
1. Capture the currently deployed stack template:
```bash
aws cloudformation get-template \
  --stack-name <stack-name> \
  --query "TemplateBody" \
  --output text > /tmp/current-template.yaml
```
2. Create a rollback change set from the last known-good template:
```bash
aws cloudformation create-change-set \
  --stack-name <stack-name> \
  --change-set-name rollback-$(date +%Y%m%d%H%M%S) \
  --template-body file:///tmp/current-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --change-set-type UPDATE
```
3. Review the change set before execution:
```bash
aws cloudformation describe-change-set \
  --stack-name <stack-name> \
  --change-set-name <change-set-name> \
  --query "Changes[*].ResourceChange.{Action:Action,LogicalResourceId:LogicalResourceId,Type:ResourceType,Replacement:Replacement}" \
  --output table
```
4. Execute rollback change set when verified:
```bash
aws cloudformation execute-change-set \
  --stack-name <stack-name> \
  --change-set-name <change-set-name>
```

## 2) Roll back Lambda functions to previous published versions
1. List versions for each backend function:
```bash
aws lambda list-versions-by-function \
  --function-name <function-name> \
  --query "Versions[*].{Version:Version,LastModified:LastModified}" \
  --output table
```
2. Update an alias (recommended) or function to point at last known-good version:
```bash
aws lambda update-alias \
  --function-name <function-name> \
  --name live \
  --function-version <previous-version>
```
If aliases are not yet in use, redeploy code from a known-good artifact:
```bash
aws lambda update-function-code \
  --function-name <function-name> \
  --zip-file fileb://<known-good-zip> \
  --publish
```

## 3) Post-rollback checks
1. Validate API health:
```bash
curl -i https://<api-domain-or-execute-api>/v1/categories
```
2. Run smoke tests for auth, booking, messaging, and payment paths.
3. Confirm CloudWatch alarms return to normal.

## 4) Incident notes
- Record rollback reason, stack/function versions, and remediation actions in `CHANGELOG.md` and incident notes.
