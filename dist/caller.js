export const createCaller = (claims) => ({
    claims,
    subject: claims.sub,
    roles: claims.roles ?? [],
    holds(requirement) {
        return claims.accessRights?.[requirement.resource]?.includes(requirement.type) === true;
    },
});
