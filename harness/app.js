/* Real SDK embed -> Form renderer -> InputCity -> mobile CityArea. No mocks. */
(() => {
  const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const state = window.validation = {
    rendererEvents: [], formChanges: [], errors: [], cityAreaObserved: false,
    initialFormData: null, controlledUpdates: 0, mobileUI: null
  };
  let scoped;
  const form = () => scoped && scoped.getComponentByName('cityForm');
  const paint = () => {
    document.querySelector('#evidence').textContent = JSON.stringify({
      data: form() ? clone(form().getValues()) : null,
      rendererEvents: state.rendererEvents, formChanges: state.formChanges,
      controlledUpdates: state.controlledUpdates, errors: state.errors
    }, null, 2);
  };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 &&
          (node.matches('.cxd-CityArea') || node.querySelector('.cxd-CityArea'))) {
        state.cityAreaObserved = true;
        if (form()) state.mobileUI = form().props.mobileUI;
      }
    }
  });
  observer.observe(document.querySelector('#root'), {childList: true, subtree: true});
  window.mountCity = config => {
    if (scoped) throw new Error('One form per fresh page is required');
    state.config = clone(config);
    const schema = {
      type: 'form', name: 'cityForm', title: '移动端城市选择', mode: 'normal',
      wrapWithPanel: true, actions: [], formLazyChange: false,
      body: [{
        type: 'input-city', name: 'address', label: '地区', ...config.props,
        onEvent: {change: {actions: [{actionType: 'custom', script: (_context, _doAction, event) => {
          state.rendererEvents.push(clone(event.data.value));
        }}]}}
      }]
    };
    scoped = amisRequire('amis/embed').embed('#root', schema, {
      mobileUI: true, locale: 'zh-CN', data: {address: clone(config.value)},
      onInit: values => { state.initialFormData = clone(values); },
      onChange: (values, diff) => {
        const data = clone(values);
        state.formChanges.push({data, diff: clone(diff)});
        state.controlledUpdates++;
        scoped.updateProps({data});
        paint();
      }
    }, {
      theme: 'cxd', locale: 'zh-CN',
      errorCatcher: (error, info) => {
        state.errors.push({name: error.name, message: error.message,
          stack: error.stack, componentStack: info.componentStack});
        paint();
      },
      fetcher: () => { throw new Error('Unexpected application API request'); }
    });
    const sample = () => {
      if (form()) {
        state.mobileUI = form().props.mobileUI;
        if (state.initialFormData === null) state.initialFormData = clone(form().getValues());
        paint();
      }
      if (!form() && !state.errors.length) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  window.readCity = () => ({...clone(state), data: form() ? clone(form().getValues()) : null});
})();
