const filterPills = document.querySelectorAll('.filter-pill');

filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    filterPills.forEach((item) => item.classList.remove('is-active'));
    pill.classList.add('is-active');
  });
});
