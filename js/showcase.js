/* ============================================================
   Showcase cards -> modal.

   The markup stays a <details> per card, so with JavaScript off the
   write-up still expands inline and remains readable and indexable.
   With JavaScript on, opening a card instead moves its content into one
   shared <dialog> and calls showModal(), which gives us for free:

     * only one card open at a time (there is only one dialog);
     * Esc to close, and a focus trap, and the rest of the page inert;
     * a ::backdrop to tint and blur behind.

   The content is moved rather than cloned, so images already decoded
   are not fetched twice and there is only ever one copy in the DOM.
   ============================================================ */
(function () {
	'use strict';

	var cards = document.querySelectorAll('details.showcase-item');
	if (!cards.length) { return; }

	// No <dialog> support: leave the plain inline <details> behaviour alone.
	var dialog = document.createElement('dialog');
	if (typeof dialog.showModal !== 'function') { return; }

	dialog.className = 'showcase-modal';
	dialog.innerHTML =
		'<button type="button" class="showcase-modal-close" aria-label="Close">' +
		'<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
		'<path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" ' +
		'stroke-linecap="round" fill="none"/></svg></button>' +
		'<div class="showcase-modal-body"></div>';
	document.body.appendChild(dialog);

	var body = dialog.querySelector('.showcase-modal-body');
	var openCard = null;

	function close() {
		if (dialog.open) { dialog.close(); }
	}

	function restore() {
		// Put the write-up back where it came from.
		if (openCard) {
			var detail = body.firstElementChild;
			if (detail) { openCard.appendChild(detail); }
			openCard.open = false;
			openCard = null;
		}
		document.body.style.overflow = '';
	}

	cards.forEach(function (card) {
		card.addEventListener('toggle', function () {
			if (!card.open || openCard === card) { return; }

			// Undo the inline expansion; the dialog is doing the work.
			card.open = false;

			var detail = card.querySelector('.showcase-detail');
			if (!detail) { return; }

			openCard = card;
			body.appendChild(detail);

			// Name the dialog after the card's own heading.
			var h = detail.querySelector('h3');
			if (h) {
				if (!h.id) { h.id = 'showcase-title-' + (card.id || Math.random().toString(36).slice(2)); }
				dialog.setAttribute('aria-labelledby', h.id);
			} else {
				dialog.removeAttribute('aria-labelledby');
			}

			document.body.style.overflow = 'hidden';   // showModal does not lock scroll
			dialog.showModal();
			body.scrollTop = 0;
		});
	});

	dialog.addEventListener('close', restore);
	dialog.querySelector('.showcase-modal-close').addEventListener('click', close);

	// Click outside the panel closes. showModal makes the backdrop part of
	// the dialog's own box, so a click landing on the dialog itself rather
	// than its contents is a backdrop click.
	dialog.addEventListener('click', function (e) {
		if (e.target === dialog) { close(); }
	});
})();
