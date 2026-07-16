(function(root) {
  function initBundleAssetSelection(options) {
    options = options || {};
    var documentRef = options.document || root.document;
    if (!documentRef) return null;

    var maxSelected = options.maxSelected || 5;
    var chips = Array.prototype.slice.call(documentRef.querySelectorAll('.bundle-asset-chip'));
    var countEl = documentRef.getElementById('bundleCount');
    var toastEl = documentRef.getElementById('bundleSelectionToast');
    var liveEl = documentRef.getElementById('bundleSelectionLive');
    var selectionOrder = [];
    var toastTimer = null;

    function getInput(chip) {
      return chip.querySelector('input[name="assets"]');
    }

    function getValue(chip) {
      var input = getInput(chip);
      return input ? input.value : '';
    }

    function getLabel(chip) {
      return chip.getAttribute('data-asset-label') || chip.textContent.trim();
    }

    function getChipByValue(value) {
      return chips.find(function(chip) {
        return getValue(chip) === value;
      }) || null;
    }

    function setText(el, text) {
      if (el) el.textContent = text;
    }

    function announce(text) {
      setText(liveEl, text);
    }

    function showToast(removedLabel, addedLabel) {
      if (!toastEl) return;
      setText(toastEl, 'Maximum of 5 assets. Replaced "' + removedLabel + '" with "' + addedLabel + '".');
      toastEl.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function() {
        toastEl.classList.remove('visible');
      }, options.toastDuration || 2000);
      if (toastTimer && typeof toastTimer.unref === 'function') {
        toastTimer.unref();
      }
    }

    function applyVisualState() {
      chips.forEach(function(chip) {
        var input = getInput(chip);
        var value = getValue(chip);
        var orderIndex = selectionOrder.indexOf(value);
        var selected = orderIndex !== -1;
        var badge = chip.querySelector('.bundle-order-badge');

        chip.classList.toggle('selected', selected);
        chip.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (input) input.checked = selected;
        if (badge) {
          badge.textContent = selected ? String(orderIndex + 1) : '';
          badge.setAttribute('aria-hidden', selected ? 'false' : 'true');
        }
      });
      setText(countEl, 'Selected Assets (' + selectionOrder.length + ' / ' + maxSelected + ')');
    }

    function normalizeInitialSelection() {
      selectionOrder = [];
      chips.forEach(function(chip) {
        var input = getInput(chip);
        var value = getValue(chip);
        if (input && input.checked && value && !selectionOrder.includes(value)) {
          selectionOrder.push(value);
        }
      });
      if (selectionOrder.length > maxSelected) {
        selectionOrder = selectionOrder.slice(0, maxSelected);
      }
      applyVisualState();
    }

    function selectChip(chip) {
      var value = getValue(chip);
      if (!value) return;
      var label = getLabel(chip);
      var existingIndex = selectionOrder.indexOf(value);

      if (existingIndex !== -1) {
        selectionOrder.splice(existingIndex, 1);
        applyVisualState();
        announce(label + ' deselected.');
        return;
      }

      if (selectionOrder.length >= maxSelected) {
        var removedValue = selectionOrder.shift();
        var removedChip = getChipByValue(removedValue);
        var removedLabel = removedChip ? getLabel(removedChip) : 'oldest asset';
        selectionOrder.push(value);
        applyVisualState();
        showToast(removedLabel, label);
        announce(label + ' selected. ' + removedLabel + ' replaced.');
        return;
      }

      selectionOrder.push(value);
      applyVisualState();
      announce(label + ' selected.');
    }

    chips.forEach(function(chip) {
      chip.setAttribute('tabindex', '0');
      chip.setAttribute('role', 'option');
      chip.addEventListener('click', function(e) {
        e.preventDefault();
        selectChip(chip);
      });
      chip.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectChip(chip);
        }
      });
    });

    normalizeInitialSelection();

    return {
      getSelectionOrder: function() {
        return selectionOrder.slice();
      },
      selectByValue: function(value) {
        var chip = getChipByValue(value);
        if (chip) selectChip(chip);
      },
      refresh: normalizeInitialSelection
    };
  }

  root.CopyQuickBundleSelection = {
    init: initBundleAssetSelection
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initBundleAssetSelection: initBundleAssetSelection };
  }
})(typeof window !== 'undefined' ? window : globalThis);
