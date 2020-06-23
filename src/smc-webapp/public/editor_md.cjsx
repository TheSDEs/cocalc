#########################################################################
# This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
# License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
#########################################################################

misc = require('smc-util/misc')

# React libraries
{React, ReactDOM, rclass, rtypes, Redux, Actions, Store}  = require('../app-framework')

{ErrorDisplay, Loading, Markdown} = require('../r_misc')

{webapp_client} = require('../webapp_client')

redux_name = (project_id, path) -> "editor-#{project_id}-#{path}"

PublicMarkdown = rclass ({name}) ->
    displayName : "PublicMarkdown"

    reduxProps :
        "#{name}" :
            content    : rtypes.string
            project_id : rtypes.string
            file_path  : rtypes.string

    render: ->
        if @props.error
            <ErrorDisplay error={@props.error}/>
        else if not @props.content?
            <Loading />
        else
            md_style =
                margin          : '20px'
                padding         : '15px'
                boxShadow       : 'rgba(87, 87, 87, 0.2) 0px 0px 12px 1px'
                backgroundColor : 'white'
                display         : 'block'   # because wrapped HTML in Markdown is a span by default
                overflowY       : 'hidden'  # for long horizontal lines; so stays in container
            <div
                className = "webapp-editor-static-html-content"
                style     = {backgroundColor: 'rgb(238, 238, 238)'}>
                <Markdown
                    project_id  = {@props.project_id}
                    file_path   = {@props.file_path}
                    style       = {md_style}
                    value       = {@props.content} />
            </div>

class MDActions extends Actions
    load_content: (project_id, path) =>
        @setState
            project_id : project_id
            file_path  : misc.path_split(path).head

       try
            content = await webapp_client.project_client.public_get_text_file
                            project_id : project_id
                            path       : path
            @setState(content: content)
        catch err
            @setState(error: err)

require('../project_file').register_file_editor
    ext       : 'md'
    is_public : true
    icon      : 'file-code-o'

    init: (path, redux, project_id) ->
        name = redux_name(project_id, path)
        if redux.getActions(name)?
            return name
        store   = redux.createStore(name)
        actions = redux.createActions(name, MDActions)
        actions.load_content(project_id, path)  # start loading
        return name

    component : PublicMarkdown

    remove: (path, redux, project_id) ->
        name = redux_name(project_id, path)
        redux.removeStore(name)
        redux.removeActions(name)
