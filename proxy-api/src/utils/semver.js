class SemVerUtil {
  static compareVersions(version1, version2) {
    if (version1 === undefined && version2 === undefined) {
      return 0;
    } else if (version1 === undefined) {
      return -1;
    } else if (version2 === undefined) {
      return 1;
    }

    const v1 = version1.split('.').map((v) => Number(v.replace(/[^0-9]/g, '')));
    const v2 = version2.split('.').map((v) => Number(v.replace(/[^0-9]/g, '')));

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0;
      const num2 = v2[i] || 0;

      if (num1 > num2) {
        return 1;
      }
      if (num1 < num2) {
        return -1;
      }
    }
    return 0;
  }
}
module.exports = SemVerUtil;
