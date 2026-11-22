function normalized(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function normalizedDisplayName(value) {
  return normalized(value).replace(/[\s|｜/／·・—–-]+/g, "");
}

export function organizationDisplayName(organization) {
  const brandName = String(organization?.brandName || "").trim();
  const name = String(organization?.name || "").trim();
  return brandName && name ? `${brandName}｜${name}` : name || brandName;
}

function compareOrganizations(left, right) {
  const leftNo = normalized(left.storeNo);
  const rightNo = normalized(right.storeNo);
  if (leftNo && rightNo) {
    const leftNumber = Number(leftNo);
    const rightNumber = Number(rightNo);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    if (leftNo !== rightNo) return leftNo < rightNo ? -1 : 1;
  } else if (leftNo || rightNo) {
    return leftNo ? -1 : 1;
  }
  return normalized(left.name) < normalized(right.name) ? -1 : normalized(left.name) > normalized(right.name) ? 1 : 0;
}

export function filterOrganizations(organizations, keyword) {
  const query = normalized(keyword);
  if (!query) return [...organizations];
  return organizations.filter((organization) => [
    organization.name,
    organization.storeNo,
    organization.address,
    organization.brandName,
    organizationDisplayName(organization)
  ].some((value) => normalized(value).includes(query)));
}

export function exactOrganizationMatch(organizations, keyword) {
  const query = normalized(keyword);
  const displayQuery = normalizedDisplayName(keyword);
  if (!query) return null;
  const matches = organizations.filter((organization) => (
    [organization.name, organization.storeNo].some((value) => normalized(value) === query)
    || normalizedDisplayName(organizationDisplayName(organization)) === displayQuery
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function groupOrganizationsByBrand(organizations, brands) {
  const activeBrands = [...brands]
    .filter((brand) => brand.status !== "inactive")
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  return activeBrands.map((brand) => ({
    brand,
    organizations: organizations
      .filter((organization) => organization.brandId === brand.id && organization.status !== "inactive")
      .sort(compareOrganizations)
  })).filter((group) => group.organizations.length > 0);
}

export function organizationTypeLabel(type) {
  return type === "department" ? "部门" : "门店";
}
