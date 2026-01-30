import { updateStock as updateNaverStock } from "./naver.js";
import { updateStock as updateCoupangStock } from "./coupang.js";
import { updateStock as updateElevenstStock } from "./elevenst.js";
import { updateStock as updateEtcStock } from "./etc.js";

function getProviderClient(provider) {
  switch (provider) {
    case "NAVER":
      return { updateStock: updateNaverStock };
    case "COUPANG":
      return { updateStock: updateCoupangStock };
    case "ELEVENST":
      return { updateStock: updateElevenstStock };
    case "ETC":
      return { updateStock: updateEtcStock };
    default:
      return { updateStock: updateEtcStock };
  }
}

export { getProviderClient };
