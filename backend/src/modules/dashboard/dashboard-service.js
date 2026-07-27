export function createDashboardService({ userService, subjectService }) {
  return {
    getDashboard(userId, subjectId) {
      const user = userService.getUser(userId);
      const subject = subjectService.getSubject(user.userId, subjectId);

      return {
        user,
        subject,
        basicStatus: {
          userStatus: user.status,
          subjectStatus: subject.status,
          ready: user.status === 'active' && subject.status === 'active',
          continuityStatus: 'not_available',
        },
      };
    },
  };
}
