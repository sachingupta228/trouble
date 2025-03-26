import { JobName } from "@enums";

import { getCompanyPositionMetadata } from "./data/CompanyPositionsMetadata";
import { CompanyPosition } from "./CompanyPosition";
import { createEnumKeyedRecord } from "../Types/Record";

export let CompanyPositions: Record<JobName, CompanyPosition> = (() => {
  let metadata = getCompanyPositionMetadata();
  return createEnumKeyedRecord(JobName, (name) => new CompanyPosition(name, metadata[name]));
})();
